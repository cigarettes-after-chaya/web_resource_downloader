import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { AppSettings, JobLogEntry, JobResult } from "@contracts/types";
import { WfButton, WfListView, WfTabs, type LvRow } from "@/components/controls";
import { useMessageBox } from "@/components/MessageBox";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HistoryDialog } from "@/components/HistoryDialog";
import { BrowseFolderDialog } from "@/components/BrowseFolderDialog";
import icon from "@/assets/icon.png";

// --- Issue classification, ported verbatim from MainForm.cs ----------------
const ErrorPatterns =
  /(^ERROR[:\s]|HTTP request sent.*\b(404|403|500|502|503|504)\b|Connection refused|Connection timed out|Name or service not known|No route to host|failed:\s|FAILED)/i;
const WarningPatterns = /(^WARNING[:\s]|Unable to establish|certificate|unlink:|Skipping)/i;
const IgnorePatterns = /(^\s*\d+K[\s.]+|saved \[|Saving to:|Length:|Converting links|saved$|\d+%\s+\d+)/i;

interface Issue {
  key: number;
  type: "Error" | "Warning";
  message: string;
  time: string;
}

export default function Home() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery();
  const saveSettingsMutation = trpc.settings.save.useMutation();
  const startMutation = trpc.downloads.start.useMutation();
  const cancelMutation = trpc.downloads.cancel.useMutation();
  const maybeCheckUpdates = trpc.updates.maybeCheck.useMutation();

  const [url, setUrl] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [logs, setLogs] = useState<JobLogEntry[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [tab, setTab] = useState(0);
  const [issuesTabTitle, setIssuesTabTitle] = useState("⚠ Errors (0)");
  const [status, setStatus] = useState("Ready");
  const [dialog, setDialog] = useState<"none" | "settings" | "history" | "browse">("none");

  const { show, confirm, messageBox } = useMessageBox();

  const urlRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const jobIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const issueKey = useRef(0);
  const countsRef = useRef({ errors: 0, warnings: 0 });

  const settings = settingsQuery.data ?? null;
  settingsRef.current = settings;

  // ApplySettings(): reflect the persisted default output folder
  useEffect(() => {
    if (settings && !outputFolder) setOutputFolder(settings.defaultOutputFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // MainForm_Load: silent update check (7-day interval handled server-side)
  useEffect(() => {
    maybeCheckUpdates.mutate(undefined, {
      onSuccess: async (r) => {
        if (r.checked && r.result.updateAvailable) {
          const yes = await confirm(
            `A new version (${r.result.latestVersion}) is available!\n\nCurrent version: ${r.result.currentVersion}\n\nWould you like to open the download page?`,
            "Update Available",
            "info",
          );
          if (yes && r.result.releaseUrl) window.open(r.result.releaseUrl, "_blank", "noopener");
        }
      },
      onError: () => {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FormClosing: warn when leaving while a download is in progress
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (downloading) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [downloading]);

  // Autoscroll log (txtLog.ScrollToCaret)
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const appendIssues = useCallback((entries: JobLogEntry[]) => {
    const fresh: Issue[] = [];
    let errors = 0;
    let warnings = 0;
    for (const e of entries) {
      const message = e.message;
      if (!message.trim() || IgnorePatterns.test(message)) continue;
      if (ErrorPatterns.test(message)) {
        errors++;
        fresh.push({
          key: ++issueKey.current,
          type: "Error",
          message: message.length > 200 ? message.slice(0, 200) + "..." : message,
          time: e.time,
        });
      } else if (WarningPatterns.test(message)) {
        warnings++;
        fresh.push({
          key: ++issueKey.current,
          type: "Warning",
          message: message.length > 200 ? message.slice(0, 200) + "..." : message,
          time: e.time,
        });
      }
    }
    if (fresh.length === 0) return;
    countsRef.current = {
      errors: countsRef.current.errors + errors,
      warnings: countsRef.current.warnings + warnings,
    };
    setIssues((prev) => [...prev, ...fresh]);
    setErrorCount(countsRef.current.errors);
    setWarningCount(countsRef.current.warnings);
  }, []);

  // UpdateErrorCount()
  useEffect(() => {
    const total = errorCount + warningCount;
    setIssuesTabTitle(`⚠ Issues (${total})`);
  }, [errorCount, warningCount]);

  // HandleDownloadCompleted(): final log lines, history refresh, notifications
  const finalize = useCallback(
    async (result: JobResult) => {
      setDownloading(false);
      setStatus("Ready");
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      utils.history.list.invalidate();

      const { errors, warnings } = countsRef.current;
      const total = errors + warnings;
      const extra: JobLogEntry[] = [];
      const mk = (message: string, i: number): JobLogEntry => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        return {
          seq: -10 - i,
          time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
          message,
        };
      };
      if (result.state === "completed" && total > 0) {
        extra.push(
          mk(`  ⚠ ${errors} error(s), ${warnings} warning(s) detected - check the Issues tab for details`, 0),
        );
      }
      if (result.state === "failed" && total > 0) {
        extra.push(mk(`  Check the Issues tab for ${errors} error(s), ${warnings} warning(s)`, 0));
        setTab(1); // the original switches to the Issues tab on failure
      }
      if (extra.length) setLogs((prev) => [...prev, ...extra]);

      const s = settingsRef.current;
      if (result.state === "cancelled") return;

      // "Open folder after download" → web equivalent: auto-download the ZIP
      if (result.state === "completed" && s?.openFolderAfterDownload && result.zipFile) {
        const a = document.createElement("a");
        a.href = `/api/files/zip/${encodeURIComponent(result.zipFile)}`;
        a.download = result.zipFile;
        a.click();
      }

      if (s?.showNotifications) {
        if (result.state === "completed") {
          await show(
            `Website downloaded successfully!\n${result.host}` +
              (result.zipFile ? `\n\nZIP archive: ${result.zipFile}` : ""),
            "Download Complete",
            "info",
          );
        } else {
          await show(`Download failed for ${result.host}`, "Download Failed", "warning");
        }
      }
    },
    [show, utils],
  );

  const poll = useCallback(() => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    fetch(`/api/jobs/${jobId}/status?cursor=${cursorRef.current}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!res) return;
        if (res.logs.length > 0) {
          cursorRef.current = res.lastSeq;
          setLogs((prev) => [...prev, ...res.logs]);
          appendIssues(res.logs);
        }
        if (res.result && res.state !== "running") {
          void finalize(res.result as JobResult);
        }
      })
      .catch(() => {});
  }, [appendIssues, finalize]);

  // ClearLog()
  const clearLog = useCallback(() => {
    setLogs([]);
    setIssues([]);
    countsRef.current = { errors: 0, warnings: 0 };
    setErrorCount(0);
    setWarningCount(0);
    setTab(0);
  }, []);

  const handleDownload = async () => {
    const text = url.trim();
    if (!text) {
      await show("Please enter a website URL.", "Error", "warning");
      urlRef.current?.focus();
      return;
    }
    let parsed: URL | null = null;
    try {
      parsed = new URL(text);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      await show(
        "Please enter a valid HTTP or HTTPS URL.\n\nExample: https://example.com",
        "Error",
        "warning",
      );
      urlRef.current?.focus();
      urlRef.current?.select();
      return;
    }
    if (!outputFolder) {
      await show("Please select an output folder.", "Error", "warning");
      setDialog("browse");
      return;
    }

    clearLog();
    try {
      const { jobId } = await startMutation.mutateAsync({ url: text, outputFolder });
      jobIdRef.current = jobId;
      cursorRef.current = 0;
      setDownloading(true);
      setStatus("Downloading...");
      poll();
      pollRef.current = setInterval(poll, 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("invalid-url")) {
        await show(
          "Please enter a valid HTTP or HTTPS URL.\n\nExample: https://example.com",
          "Error",
          "warning",
        );
      } else {
        await show(`Download failed: ${msg.replace(/^TRPCClientError[^:]*:?\s*/, "")}`, "Error", "error");
      }
    }
  };

  const handleCancel = () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    // "Cancelling download..." appears in the log immediately, as in the original
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const entry: JobLogEntry = {
      seq: -1,
      time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      message: "Cancelling download...",
    };
    setLogs((prev) => [...prev, entry]);
    cancelMutation.mutate({ jobId });
  };

  const handleSaveSettings = async (draft: AppSettings) => {
    await saveSettingsMutation.mutateAsync(draft);
    await utils.settings.get.invalidate();
  };

  const handleSelectFolder = (folder: string) => {
    setOutputFolder(folder);
    if (settings) {
      saveSettingsMutation.mutate({ ...settings, defaultOutputFolder: folder });
    }
  };

  const issueRows: LvRow[] = issues.map((i) => ({
    key: i.key,
    className: i.type === "Error" ? "lv-error" : "lv-warning",
    cells: [i.type, i.message, i.time],
  }));

  const issuesCount = errorCount + warningCount;

  return (
    <div className="wf-stage">
      <div className="wf-window" role="main" aria-label="Website Downloader">
        {/* panelHeader */}
        <header className="wf-app-header">
          <img src={icon} alt="Website Downloader logo" />
          <h1>Website Downloader</h1>
        </header>

        <div className="wf-body">
          {/* Website URL */}
          <label className="wf-label" htmlFor="wf-url" style={{ marginTop: 15 - 12 }}>
            Website URL:
          </label>
          <input
            id="wf-url"
            ref={urlRef}
            className="wf-input"
            placeholder="https://example.com"
            value={url}
            disabled={downloading}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !downloading && outputFolder) void handleDownload();
            }}
            autoFocus
          />

          {/* Output Folder */}
          <label className="wf-label" style={{ marginTop: 8 }}>
            Output Folder:
          </label>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div className="wf-static-box" style={{ flex: 1, minWidth: 0 }} title={outputFolder}>
              {outputFolder ? `downloads\\${outputFolder}` : ""}
            </div>
            <WfButton
              onClick={() => setDialog("browse")}
              disabled={downloading}
              style={{ width: 102, height: 30, flex: "none" }}
            >
              Browse...
            </WfButton>
          </div>

          {/* action row */}
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginTop: 15,
              flexWrap: "wrap",
            }}
          >
            <WfButton
              onClick={() => setDialog("settings")}
              disabled={downloading}
              style={{ width: 90, height: 40 }}
            >
              ⚙ Settings
            </WfButton>
            <WfButton
              onClick={() => setDialog("history")}
              style={{ width: 90, height: 40 }}
            >
              📋 History
            </WfButton>
            <span style={{ flex: 1 }} />
            {!downloading ? (
              <WfButton
                variant="primary"
                onClick={handleDownload}
                disabled={!outputFolder || startMutation.isPending}
                style={{ width: 230 }}
                className="wf-download-btn"
              >
                ⬇&nbsp; Download Website
              </WfButton>
            ) : (
              <WfButton variant="danger" onClick={handleCancel} style={{ width: 230 }} className="wf-download-btn">
                ✖&nbsp; Cancel Download
              </WfButton>
            )}
          </div>

          {/* marquee progress bar (visible while downloading) */}
          {downloading && (
            <div className="wf-progress" style={{ marginTop: 10 }} aria-label="Download in progress">
              <div className="marquee" />
            </div>
          )}

          {/* output tabs */}
          <div style={{ marginTop: 10, flex: "1 1 auto", minHeight: 120, display: "flex" }}>
            <WfTabs
              tabs={["📋 Output", issuesTabTitle]}
              active={tab}
              onChange={setTab}
              className="wf-output-tabs"
            >
              {tab === 0 ? (
                <div className="wf-log" ref={logRef} tabIndex={0} aria-label="Download log">
                  {logs.map((l, i) => (
                    <div key={`${l.seq}-${i}`}>
                      [{l.time}] {l.message}
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="dim">
                      Download output will appear here. Enter a URL and press "Download Website".
                    </div>
                  )}
                </div>
              ) : (
                <WfListView
                  columns={[
                    { title: "Type", width: 70 },
                    { title: "Message", width: 420 },
                    { title: "Time", width: 80 },
                  ]}
                  rows={issueRows}
                  emptyText="No issues detected"
                />
              )}
            </WfTabs>
          </div>
        </div>

        {/* statusStrip */}
        <footer className="wf-status">
          <span>{status}</span>
          <span className="alert">
            {issuesCount > 0 ? `  |  ⚠ ${errorCount} error(s), ${warningCount} warning(s)` : ""}
          </span>
          {downloading && <span style={{ marginLeft: "auto" }} className="wf-hint">wget-compatible engine</span>}
        </footer>
      </div>

      {/* Dialogs */}
      {dialog === "settings" && settings && (
        <SettingsDialog
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setDialog("none")}
        />
      )}
      {dialog === "history" && (
        <HistoryDialog
          onPick={(picked) => setUrl(picked)}
          onClose={() => setDialog("none")}
        />
      )}
      {dialog === "browse" && (
        <BrowseFolderDialog
          current={outputFolder}
          onSelect={handleSelectFolder}
          onClose={() => setDialog("none")}
        />
      )}
      {messageBox}
    </div>
  );
}
