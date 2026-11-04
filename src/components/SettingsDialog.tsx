import { useRef, useState } from "react";
import {
  RESUME_MODE_HINTS,
  RESUME_MODE_LABELS,
  RATE_LIMIT_PATTERN,
  DownloadEngine,
  type AppSettings,
} from "@contracts/types";
import {
  WfButton,
  WfCheckbox,
  WfCombo,
  WfDialog,
  WfGroupBox,
  WfNumeric,
  WfTabs,
} from "./controls";
import { useMessageBox } from "./MessageBox";

const ENGINE_ITEMS = [
  "wget (fast, no JavaScript)",
  "Playwright (full browser, handles JS sites)",
] as const;

/**
 * SettingsForm reconstruction — 4 tabs (Download / Advanced / Schedule /
 * Interface), Reset Defaults / Save / Cancel, identical validation messages.
 */
export function SettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (draft: AppSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [tab, setTab] = useState(0);
  const { show, confirm, messageBox } = useMessageBox();
  const refs = {
    userAgent: useRef<HTMLInputElement>(null),
    rateLimit: useRef<HTMLInputElement>(null),
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const validate = async (): Promise<boolean> => {
    if (!draft.userAgent.trim()) {
      await show("User Agent cannot be empty.", "Validation Error", "warning");
      setTab(0);
      refs.userAgent.current?.focus();
      return false;
    }
    if (!RATE_LIMIT_PATTERN.test(draft.rateLimit.trim())) {
      await show(
        "Invalid rate limit format.\n\nExpected format: number followed by optional k, m, or g\nExamples: 200k, 1m, 500",
        "Validation Error",
        "warning",
      );
      setTab(0);
      refs.rateLimit.current?.focus();
      return false;
    }
    if (draft.maxDepth < 0 || draft.maxDepth > 100) {
      await show("Max depth must be between 0 and 100 (0 = unlimited).", "Validation Error", "warning");
      setTab(0);
      return false;
    }
    if (draft.waitBetweenRequests < 0 || draft.waitBetweenRequests > 300) {
      await show("Wait between requests must be between 0 and 300 seconds.", "Validation Error", "warning");
      setTab(0);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (await validate()) {
      await onSave({ ...draft, userAgent: draft.userAgent.trim(), rateLimit: draft.rateLimit.trim() });
      onClose();
    }
  };

  const handleReset = async () => {
    if (
      await confirm(
        "Are you sure you want to reset all settings to their default values?",
        "Reset Settings",
        "question",
      )
    ) {
      const { DEFAULT_SETTINGS } = await import("@contracts/types");
      setDraft({ ...DEFAULT_SETTINGS, defaultOutputFolder: draft.defaultOutputFolder });
    }
  };

  const engineStatus =
    draft.engine === DownloadEngine.Playwright
      ? {
          text: "Status: Not available in the web version (no browser runtime) — the wget-compatible engine will be used",
          color: "#ff0000",
        }
      : null;

  return (
    <WfDialog title="Settings" onClose={onClose} width={484} height="min(545px, calc(100dvh - 32px))">
      <div className="wf-dialog-body" style={{ padding: 12 }}>
        <WfTabs
          tabs={["Download", "Advanced", "Schedule", "Interface"]}
          active={tab}
          onChange={setTab}
        >
          <div className="wf-settings-tabcontent">
            {tab === 0 && (
              <>
                <label className="wf-label" htmlFor="wf-useragent">User Agent:</label>
                <input
                  id="wf-useragent"
                  ref={refs.userAgent}
                  className="wf-input"
                  style={{ height: 23, fontSize: 13, marginBottom: 12 }}
                  value={draft.userAgent}
                  onChange={(e) => set("userAgent", e.target.value)}
                />
                <WfCheckbox
                  label="Convert links for offline viewing"
                  checked={draft.convertLinksForOffline}
                  onChange={(v) => set("convertLinksForOffline", v)}
                  style={{ marginBottom: 8 }}
                />
                <WfCheckbox
                  label="Adjust file extensions for content type"
                  checked={draft.adjustExtensions}
                  onChange={(v) => set("adjustExtensions", v)}
                  style={{ marginBottom: 14 }}
                />
                <div className="wf-field-row">
                  <span className="wf-label">Max Depth (0=unlimited):</span>
                  <WfNumeric
                    value={draft.maxDepth}
                    min={0}
                    max={100}
                    onChange={(v) => set("maxDepth", v)}
                  />
                </div>
                <div className="wf-field-row">
                  <span className="wf-label">Wait Between Requests (sec):</span>
                  <WfNumeric
                    value={draft.waitBetweenRequests}
                    min={0}
                    max={300}
                    onChange={(v) => set("waitBetweenRequests", v)}
                  />
                </div>
                <div className="wf-field-row">
                  <span className="wf-label">Rate Limit:</span>
                  <input
                    ref={refs.rateLimit}
                    className="wf-input"
                    style={{ width: 80, height: 23, fontSize: 13 }}
                    value={draft.rateLimit}
                    onChange={(e) => set("rateLimit", e.target.value)}
                  />
                  <span className="wf-hint">(e.g., 500k, 2m - empty = unlimited)</span>
                </div>
                <div className="wf-field-row" style={{ alignItems: "flex-start" }}>
                  <span className="wf-label" style={{ paddingTop: 2 }}>On restart (resume/skip):</span>
                  <span>
                    <WfCombo
                      items={RESUME_MODE_LABELS}
                      selectedIndex={draft.resumeMode}
                      onChange={(i) => set("resumeMode", i as AppSettings["resumeMode"])}
                      width={260}
                    />
                    <div className="wf-hint" style={{ maxWidth: 265, marginTop: 4 }}>
                      {RESUME_MODE_HINTS[draft.resumeMode]}
                    </div>
                  </span>
                </div>
                <WfCheckbox
                  label="Ignore SSL certificate errors"
                  checked={draft.ignoreSslErrors}
                  onChange={(v) => set("ignoreSslErrors", v)}
                  style={{ marginTop: 6 }}
                />
              </>
            )}

            {tab === 1 && (
              <>
                <div className="wf-field-row">
                  <span className="wf-label">Connection Timeout (sec):</span>
                  <WfNumeric
                    value={draft.connectionTimeout}
                    min={5}
                    max={300}
                    width={80}
                    onChange={(v) => set("connectionTimeout", v)}
                  />
                </div>
                <div className="wf-field-row">
                  <span className="wf-label">Read Timeout (sec):</span>
                  <WfNumeric
                    value={draft.readTimeout}
                    min={10}
                    max={600}
                    width={80}
                    onChange={(v) => set("readTimeout", v)}
                  />
                </div>
                <div className="wf-field-row">
                  <span className="wf-label">Retry Count:</span>
                  <WfNumeric
                    value={draft.retryCount}
                    min={0}
                    max={20}
                    width={80}
                    onChange={(v) => set("retryCount", v)}
                  />
                </div>
                <WfGroupBox title="Post-Download Options" style={{ marginBottom: 12 }}>
                  <WfCheckbox
                    label="Export to ZIP after download"
                    checked={draft.exportToZip}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        exportToZip: v,
                        deleteAfterZip: v ? d.deleteAfterZip : false,
                      }))
                    }
                    style={{ marginBottom: 8 }}
                  />
                  <WfCheckbox
                    label="Delete original folder after zipping"
                    checked={draft.deleteAfterZip}
                    disabled={!draft.exportToZip}
                    onChange={(v) => set("deleteAfterZip", v)}
                    style={{ marginLeft: 20 }}
                  />
                </WfGroupBox>
                <WfGroupBox title="Multi-Threading" style={{ marginBottom: 12 }}>
                  <WfCheckbox
                    label="Enable multi-threaded downloads"
                    checked={draft.enableMultiThreaded}
                    onChange={(v) => set("enableMultiThreaded", v)}
                    style={{ marginBottom: 8 }}
                  />
                  <div className="wf-field-row" style={{ marginLeft: 20, marginBottom: 0 }}>
                    <span className="wf-label">Number of Threads:</span>
                    <WfNumeric
                      value={draft.threadCount}
                      min={1}
                      max={16}
                      disabled={!draft.enableMultiThreaded}
                      onChange={(v) => set("threadCount", v)}
                    />
                  </div>
                </WfGroupBox>
                <WfCheckbox
                  label="Check for updates on startup"
                  checked={draft.checkForUpdates}
                  onChange={(v) => set("checkForUpdates", v)}
                  style={{ marginBottom: 12 }}
                />
                <WfGroupBox title="Download Engine">
                  <div className="wf-field-row">
                    <span className="wf-label">Engine:</span>
                    <WfCombo
                      items={ENGINE_ITEMS}
                      selectedIndex={draft.engine}
                      onChange={(i) => set("engine", i as AppSettings["engine"])}
                      width={270}
                    />
                  </div>
                  {engineStatus && (
                    <div style={{ color: engineStatus.color, fontSize: 12, marginBottom: 8, maxWidth: 380 }}>
                      {engineStatus.text}
                    </div>
                  )}
                  <WfCheckbox
                    label="Strip analytics/tracking scripts for offline viewing"
                    checked={draft.stripAnalyticsScripts}
                    onChange={(v) => set("stripAnalyticsScripts", v)}
                  />
                </WfGroupBox>
              </>
            )}

            {tab === 2 && (
              <>
                <WfCheckbox
                  label="Enable bandwidth scheduling"
                  checked={draft.enableBandwidthScheduler}
                  onChange={(v) => set("enableBandwidthScheduler", v)}
                  style={{ marginBottom: 12 }}
                />
                <WfGroupBox title="Schedule Settings">
                  <div className="wf-field-row">
                    <span className="wf-label">Peak Hours Rate Limit:</span>
                    <input
                      className="wf-input"
                      style={{ width: 80, height: 23, fontSize: 13 }}
                      value={draft.peakHoursRateLimit}
                      disabled={!draft.enableBandwidthScheduler}
                      onChange={(e) => set("peakHoursRateLimit", e.target.value)}
                    />
                  </div>
                  <div className="wf-field-row">
                    <span className="wf-label">Off-Peak Hours Rate Limit:</span>
                    <input
                      className="wf-input"
                      style={{ width: 80, height: 23, fontSize: 13 }}
                      value={draft.offPeakRateLimit}
                      disabled={!draft.enableBandwidthScheduler}
                      onChange={(e) => set("offPeakRateLimit", e.target.value)}
                    />
                  </div>
                  <div className="wf-field-row">
                    <span className="wf-label">Peak Hours Start (24h):</span>
                    <WfNumeric
                      value={draft.peakHoursStart}
                      min={0}
                      max={23}
                      disabled={!draft.enableBandwidthScheduler}
                      onChange={(v) => set("peakHoursStart", v)}
                    />
                  </div>
                  <div className="wf-field-row">
                    <span className="wf-label">Peak Hours End (24h):</span>
                    <WfNumeric
                      value={draft.peakHoursEnd}
                      min={0}
                      max={23}
                      disabled={!draft.enableBandwidthScheduler}
                      onChange={(v) => set("peakHoursEnd", v)}
                    />
                  </div>
                  <div className="wf-hint">
                    Limit bandwidth during peak hours, use unlimited/faster speed off-peak.
                  </div>
                </WfGroupBox>
              </>
            )}

            {tab === 3 && (
              <>
                <WfCheckbox
                  label="Open folder after download completes"
                  checked={draft.openFolderAfterDownload}
                  onChange={(v) => set("openFolderAfterDownload", v)}
                  style={{ marginBottom: 8 }}
                />
                <div className="wf-hint" style={{ margin: "-4px 0 10px 20px" }}>
                  Web version: automatically downloads the result when a ZIP is created.
                </div>
                <WfCheckbox
                  label="Show desktop notifications"
                  checked={draft.showNotifications}
                  onChange={(v) => set("showNotifications", v)}
                />
                <div className="wf-hint" style={{ margin: "4px 0 0 20px" }}>
                  Web version: notifications appear as in-app dialogs.
                </div>
              </>
            )}
          </div>
        </WfTabs>
      </div>
      <div className="wf-dialog-footer" style={{ justifyContent: "space-between" }}>
        <WfButton onClick={handleReset} style={{ width: 100, height: 28 }}>
          Reset Defaults
        </WfButton>
        <span style={{ display: "flex", gap: 6 }}>
          <WfButton onClick={handleSave} style={{ width: 75, height: 28 }}>
            Save
          </WfButton>
          <WfButton onClick={onClose} style={{ width: 75, height: 28 }}>
            Cancel
          </WfButton>
        </span>
      </div>
      {messageBox}
    </WfDialog>
  );
}
