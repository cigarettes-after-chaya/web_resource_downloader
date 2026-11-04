import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Zip, ZipDeflate } from "fflate";
import { Crawler } from "./crawler";
import { DOWNLOADS_DIR, ZIPS_DIR, ensureFolder, formatSize } from "./storage";
import { addHistory } from "../queries/history";
import { log as appLog } from "../lib/logger";
import {
  DownloadEngine,
  type AppSettings,
  type JobLogEntry,
  type JobResult,
  type JobState,
} from "@contracts/types";

/**
 * In-memory registry of download jobs (the desktop app was single-job,
 * single-process; the web version keeps jobs in the server process).
 */
interface Job {
  id: string;
  state: JobState;
  logs: JobLogEntry[];
  seq: number;
  result: JobResult | null;
  crawler: Crawler | null;
  cancelled: boolean;
  startedAt: number;
}

const jobs = new Map<string, Job>();
const MAX_LOG_LINES = 5000;

/** Port of BandwidthScheduler from the original app. */
function schedulerStatus(s: AppSettings): {
  enabled: boolean;
  isPeak: boolean;
  currentRateLimit: string;
  description: string;
} {
  if (!s.enableBandwidthScheduler) {
    return {
      enabled: false,
      isPeak: false,
      currentRateLimit: s.rateLimit,
      description: "Bandwidth scheduler disabled",
    };
  }
  const hour = new Date().getHours();
  const { peakHoursStart: start, peakHoursEnd: end } = s;
  const isPeak =
    start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
  const currentRateLimit = isPeak ? s.peakHoursRateLimit : s.offPeakRateLimit;
  const nextChangeHour = isPeak ? end : start;
  const next = new Date();
  next.setHours(nextChangeHour, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  const hh = String(next.getHours()).padStart(2, "0");
  const description = `Currently in ${isPeak ? "peak hours" : "off-peak hours"} (rate: ${
    currentRateLimit || "unlimited"
  }). Changes at ${hh}:00.`;
  return { enabled: true, isPeak, currentRateLimit, description };
}

function makeLogger(job: Job): (message: string) => void {
  return (message) => {
    if (!message) return;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    job.seq++;
    job.logs.push({
      seq: job.seq,
      time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      message,
    });
    if (job.logs.length > MAX_LOG_LINES) {
      job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
    }
  };
}

export function startJob(
  url: string,
  outputFolder: string,
  settings: AppSettings,
): { jobId: string } {
  const job: Job = {
    id: crypto.randomUUID(),
    state: "running",
    logs: [],
    seq: 0,
    result: null,
    crawler: null,
    cancelled: false,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  void runJob(job, url, outputFolder, settings).catch((e) => {
    appLog.error("download job crashed", { jobId: job.id, error: String(e) });
  });
  return { jobId: job.id };
}

async function runJob(
  job: Job,
  url: string,
  outputFolder: string,
  settings: AppSettings,
): Promise<void> {
  const log = makeLogger(job);
  const startedAt = job.startedAt;
  const u = new URL(url);
  const host = u.host;
  const sched = schedulerStatus(settings);

  // Mirror MainForm.StartDownloadAsync logging
  log(`Starting download: ${url}`);
  log(`Output folder: ${outputFolder}`);
  if (sched.enabled) {
    log("Bandwidth scheduler: " + sched.description);
  }
  log("---");

  let result: JobResult;
  try {
    const outDir = ensureFolder(outputFolder);
    const crawler = new Crawler(
      {
        url,
        outputDir: outDir,
        settings,
        rateLimit: sched.currentRateLimit,
      },
      { log, isCancelled: () => job.cancelled },
    );
    job.crawler = crawler;

    const crawl = await crawler.run();
    const durationSec = (Date.now() - startedAt) / 1000;
    log("---");

    if (crawl.cancelled) {
      log("Download cancelled.");
      result = {
        state: "cancelled",
        url,
        host,
        outputFolder,
        durationSec,
        exitCode: crawl.exitCode,
        errorMessage: null,
        filesDownloaded: crawl.filesDownloaded,
        bytesDownloaded: crawl.bytesDownloaded,
        zipFile: null,
      };
    } else if (crawl.success) {
      const mm = String(Math.floor(durationSec / 60)).padStart(2, "0");
      const ss = String(Math.floor(durationSec % 60)).padStart(2, "0");
      log(`✓ Download completed successfully! Duration: ${mm}:${ss}`);
      log(`FINISHED --${ts()}--`);
      log(
        `Downloaded: ${crawl.filesDownloaded} files, ${formatSize(crawl.bytesDownloaded)} in ${durationSec.toFixed(1)}s`,
      );
      if (crawl.exitCode !== 0) {
        log(`  (wget exit code ${crawl.exitCode} - some resources may have been unavailable)`);
      }
      let zipFile: string | null = null;
      if (settings.exportToZip) {
        zipFile = await exportZip(log, outDir, host, settings.deleteAfterZip);
      }
      result = {
        state: "completed",
        url,
        host,
        outputFolder,
        durationSec,
        exitCode: crawl.exitCode,
        errorMessage: null,
        filesDownloaded: crawl.filesDownloaded,
        bytesDownloaded: crawl.bytesDownloaded,
        zipFile,
      };
    } else {
      log(`✗ Download failed. wget exit code: ${crawl.exitCode}`);
      result = {
        state: "failed",
        url,
        host,
        outputFolder,
        durationSec,
        exitCode: crawl.exitCode || 8,
        errorMessage: "Download failed",
        filesDownloaded: crawl.filesDownloaded,
        bytesDownloaded: crawl.bytesDownloaded,
        zipFile: null,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("Error: " + msg);
    result = {
      state: "failed",
      url,
      host,
      outputFolder,
      durationSec: (Date.now() - startedAt) / 1000,
      exitCode: 1,
      errorMessage: msg,
      filesDownloaded: 0,
      bytesDownloaded: 0,
      zipFile: null,
    };
  }

  job.result = result;
  job.state = result.state;
  job.crawler = null;

  // Persist to history (DownloadHistory.Add in the original)
  try {
    await addHistory({
      url,
      outputFolder,
      durationSec: result.durationSec,
      success: result.state === "completed",
      errorMessage: result.errorMessage,
    });
  } catch (e) {
    appLog.error("failed to persist history", { error: String(e) });
  }
}

async function exportZip(
  log: (m: string) => void,
  sourceDir: string,
  host: string,
  deleteAfterZip: boolean,
): Promise<string | null> {
  log("Creating ZIP archive...");
  try {
    const zipName = uniqueZipName(host);
    const zipPath = path.join(ZIPS_DIR, zipName);
    await zipDirectory(sourceDir, zipPath);
    const size = fs.statSync(zipPath).size;
    log(`ZIP created: ${zipName} (${formatSize(size)})`);
    if (deleteAfterZip) {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      log("Original folder deleted after zipping.");
    }
    return zipName;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Failed to create ZIP: ${msg}`);
    return null;
  }
}

function uniqueZipName(host: string): string {
  const safe = host.replace(/[^\w.-]/g, "_");
  let name = `${safe}.zip`;
  let i = 1;
  while (fs.existsSync(path.join(ZIPS_DIR, name))) {
    name = `${safe}-${++i}.zip`;
  }
  return name;
}

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Streams a directory tree into a zip file (fflate, deflate). */
function zipDirectory(sourceDir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        out.destroy();
        reject(err);
        return;
      }
      out.write(chunk);
      if (final) out.end();
    });
    out.on("close", () => resolve());
    out.on("error", reject);

    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(abs, rel);
        } else {
          const f = new ZipDeflate(rel, { level: 6 });
          zip.add(f);
          f.push(fs.readFileSync(abs), true);
        }
      }
    };
    walk(sourceDir, "");
    zip.end();
  });
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.state !== "running") return false;
  job.cancelled = true;
  job.crawler?.cancel();
  return true;
}

export function getJobStatus(
  jobId: string,
  cursor: number,
): { state: JobState; logs: JobLogEntry[]; lastSeq: number; result: JobResult | null } | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    state: job.state,
    logs: job.logs.filter((l) => l.seq > cursor),
    lastSeq: job.seq,
    result: job.result,
  };
}

export function getActiveJob(): { jobId: string; url: string } | null {
  for (const [id, job] of jobs) {
    if (job.state === "running") {
      const first = job.logs.find((l) => l.message.startsWith("Starting download: "));
      return { jobId: id, url: first?.message.slice(19) ?? "" };
    }
  }
  return null;
}

export function zipFilePath(name: string): string | null {
  const safe = path.basename(name);
  const p = path.join(ZIPS_DIR, safe);
  return fs.existsSync(p) ? p : null;
}

export { DOWNLOADS_DIR };
export const ENGINE_WGET = DownloadEngine.Wget;
