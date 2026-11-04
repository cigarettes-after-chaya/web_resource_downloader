import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import {
  loadSettings,
  saveSettings,
  validateAndFix,
} from "./queries/settings";
import { listHistory, clearHistory } from "./queries/history";
import {
  startJob,
  cancelJob,
  getJobStatus,
  getActiveJob,
} from "./services/jobs";
import { checkForUpdates, shouldCheckForUpdates } from "./services/updates";
import {
  ensureFolder,
  isValidFolderName,
  listFolders,
} from "./services/storage";
import {
  DEFAULT_SETTINGS,
  RATE_LIMIT_STRICT_PATTERN,
  type AppSettings,
} from "@contracts/types";

const settingsSchema = z.object({
  defaultOutputFolder: z.string(),
  userAgent: z.string(),
  convertLinksForOffline: z.boolean(),
  adjustExtensions: z.boolean(),
  maxDepth: z.number().int(),
  waitBetweenRequests: z.number().int(),
  rateLimit: z.string(),
  resumeMode: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  ignoreSslErrors: z.boolean(),
  connectionTimeout: z.number().int(),
  readTimeout: z.number().int(),
  retryCount: z.number().int(),
  exportToZip: z.boolean(),
  deleteAfterZip: z.boolean(),
  enableMultiThreaded: z.boolean(),
  threadCount: z.number().int(),
  engine: z.union([z.literal(0), z.literal(1)]),
  stripAnalyticsScripts: z.boolean(),
  enableBandwidthScheduler: z.boolean(),
  peakHoursRateLimit: z.string(),
  offPeakRateLimit: z.string(),
  peakHoursStart: z.number().int(),
  peakHoursEnd: z.number().int(),
  checkForUpdates: z.boolean(),
  lastUpdateCheck: z.string().nullable(),
  openFolderAfterDownload: z.boolean(),
  showNotifications: z.boolean(),
});

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  settings: createRouter({
    get: publicQuery.query(async (): Promise<AppSettings> => loadSettings()),

    save: publicQuery
      .input(settingsSchema)
      .mutation(async ({ input }): Promise<{ ok: true }> => {
        await saveSettings(input as AppSettings);
        return { ok: true };
      }),

    resetDefaults: publicQuery.query(
      async (): Promise<AppSettings> => ({ ...DEFAULT_SETTINGS }),
    ),
  }),

  history: createRouter({
    list: publicQuery.query(() => listHistory()),
    clear: publicQuery.mutation(async () => {
      await clearHistory();
      return { ok: true };
    }),
  }),

  folders: createRouter({
    list: publicQuery.query(() => ({ folders: listFolders() })),
    create: publicQuery
      .input(z.object({ name: z.string().min(1).max(64) }))
      .mutation(({ input }) => {
        if (!isValidFolderName(input.name)) {
          throw new Error(
            "Invalid folder name. Use letters, numbers, spaces, dots, - and _ only.",
          );
        }
        ensureFolder(input.name);
        return { ok: true as const, name: input.name };
      }),
  }),

  downloads: createRouter({
    start: publicQuery
      .input(z.object({ url: z.string(), outputFolder: z.string() }))
      .mutation(async ({ input }) => {
        const url = input.url.trim();
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("invalid-url");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid-url");
        }
        if (!isValidFolderName(input.outputFolder)) {
          throw new Error("invalid-folder");
        }
        const settings = await loadSettings();
        // Mirror WgetDownloader.ValidateOptions: strict rate limit check
        if (
          settings.rateLimit &&
          !RATE_LIMIT_STRICT_PATTERN.test(settings.rateLimit)
        ) {
          throw new Error(
            `Invalid rate limit format: '${settings.rateLimit}'. Expected format: number followed by optional k, m, or g (e.g., '200k', '1m')`,
          );
        }
        return startJob(url, input.outputFolder, settings);
      }),

    cancel: publicQuery
      .input(z.object({ jobId: z.string() }))
      .mutation(({ input }) => ({ ok: cancelJob(input.jobId) })),

    status: publicQuery
      .input(z.object({ jobId: z.string(), cursor: z.number().int() }))
      .query(({ input }) => getJobStatus(input.jobId, input.cursor)),

    active: publicQuery.query(() => getActiveJob()),
  }),

  updates: createRouter({
    /** Silent startup check (respects the 7-day interval) */
    maybeCheck: publicQuery.mutation(async () => {
      const settings = await loadSettings();
      if (!settings.checkForUpdates) return { checked: false as const };
      if (!shouldCheckForUpdates(settings.lastUpdateCheck))
        return { checked: false as const };
      const result = await checkForUpdates();
      settings.lastUpdateCheck = new Date().toISOString();
      await saveSettings(validateAndFix(settings));
      return { checked: true as const, result };
    }),
    /** Manual check from the UI */
    check: publicQuery.mutation(async () => {
      const settings = await loadSettings();
      const result = await checkForUpdates();
      settings.lastUpdateCheck = new Date().toISOString();
      await saveSettings(validateAndFix(settings));
      return result;
    }),
  }),
});

export type AppRouter = typeof appRouter;
