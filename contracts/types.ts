// Shared types ported from the original WebsiteDownloader .NET models.
// Used by both the Hono/tRPC backend and the React frontend.

export * from "./errors";

/** DownloadEngine enum (WebsiteDownloader.Services.DownloadEngine) */
export const DownloadEngine = { Wget: 0, Playwright: 1 } as const;
export type DownloadEngine = (typeof DownloadEngine)[keyof typeof DownloadEngine];

/** ResumeMode enum (WebsiteDownloader.Services.ResumeMode) */
export const ResumeMode = {
  Off: 0,
  Continue: 1,
  Timestamping: 2,
  NoClobber: 3,
} as const;
export type ResumeMode = (typeof ResumeMode)[keyof typeof ResumeMode];

export const RESUME_MODE_LABELS = [
  "Re-download everything (overwrite)",
  "Continue interrupted file",
  "Skip up-to-date files (recommended)",
  "Skip all existing files",
] as const;

export const RESUME_MODE_HINTS = [
  "No resume: existing files may be re-downloaded and overwritten.",
  "Resumes a single partly-downloaded file (-c). Does not skip files that already finished.",
  "Skips files already up-to-date, re-fetches only missing or changed ones (-N).",
  "Never re-downloads anything already on disk (-nc). Fast, but won't refresh changed files.",
] as const;

/** AppSettings (WebsiteDownloader.Models.AppSettings) with original defaults */
export interface AppSettings {
  defaultOutputFolder: string;
  userAgent: string;
  convertLinksForOffline: boolean;
  adjustExtensions: boolean;
  maxDepth: number;
  waitBetweenRequests: number;
  rateLimit: string;
  resumeMode: ResumeMode;
  ignoreSslErrors: boolean;
  connectionTimeout: number;
  readTimeout: number;
  retryCount: number;
  exportToZip: boolean;
  deleteAfterZip: boolean;
  enableMultiThreaded: boolean;
  threadCount: number;
  engine: DownloadEngine;
  stripAnalyticsScripts: boolean;
  enableBandwidthScheduler: boolean;
  peakHoursRateLimit: string;
  offPeakRateLimit: string;
  peakHoursStart: number;
  peakHoursEnd: number;
  checkForUpdates: boolean;
  lastUpdateCheck: string | null; // ISO date, null = never (DateTime.MinValue)
  openFolderAfterDownload: boolean;
  showNotifications: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultOutputFolder: "default",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  convertLinksForOffline: true,
  adjustExtensions: true,
  maxDepth: 0,
  waitBetweenRequests: 0,
  rateLimit: "",
  resumeMode: ResumeMode.Timestamping,
  ignoreSslErrors: false,
  connectionTimeout: 30,
  readTimeout: 60,
  retryCount: 3,
  exportToZip: false,
  deleteAfterZip: false,
  enableMultiThreaded: false,
  threadCount: 4,
  engine: DownloadEngine.Wget,
  stripAnalyticsScripts: true,
  enableBandwidthScheduler: false,
  peakHoursRateLimit: "100k",
  offPeakRateLimit: "",
  peakHoursStart: 9,
  peakHoursEnd: 17,
  checkForUpdates: true,
  lastUpdateCheck: null,
  openFolderAfterDownload: true,
  showNotifications: true,
};

/** ValidationPatterns.RateLimit from the original app */
export const RATE_LIMIT_PATTERN = /^$|^\d+[kmg]?$/i;
export const RATE_LIMIT_STRICT_PATTERN = /^\d+[kmg]?$/i;

/** DownloadHistoryItem (WebsiteDownloader.Models.DownloadHistoryItem) */
export interface DownloadHistoryItem {
  id: number;
  url: string;
  outputFolder: string;
  downloadDate: Date;
  /** duration in whole seconds */
  durationSec: number;
  success: boolean;
  errorMessage: string | null;
}

export type JobState =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobLogEntry {
  seq: number;
  time: string; // HH:mm:ss
  message: string;
}

export interface JobResult {
  state: JobState;
  url: string;
  host: string;
  outputFolder: string;
  durationSec: number;
  /** emulated wget exit code (0 = success, 8 = server issued an error response) */
  exitCode: number;
  errorMessage: string | null;
  filesDownloaded: number;
  bytesDownloaded: number;
  zipFile: string | null; // file name, downloadable via /api/files/zip/<name>
}

export interface JobStatus {
  state: JobState;
  logs: JobLogEntry[]; // entries with seq > cursor
  lastSeq: number;
  result: JobResult | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
  errorMessage: string | null;
}
