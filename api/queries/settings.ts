import { eq } from "drizzle-orm";
import { getDb } from "./connection";
import { appSettings } from "@db/schema";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "@contracts/types";

/** Port of AppSettings.ValidateAndFix() from the original app. */
export function validateAndFix(s: AppSettings): AppSettings {
  const out = { ...s };
  if (!out.userAgent || !out.userAgent.trim())
    out.userAgent = DEFAULT_SETTINGS.userAgent;
  if (!out.defaultOutputFolder || !out.defaultOutputFolder.trim())
    out.defaultOutputFolder = DEFAULT_SETTINGS.defaultOutputFolder;
  out.maxDepth = clamp(out.maxDepth, 0, 100);
  out.waitBetweenRequests = clamp(out.waitBetweenRequests, 0, 300);
  out.connectionTimeout = clamp(out.connectionTimeout, 5, 300);
  out.readTimeout = clamp(out.readTimeout, 10, 600);
  out.retryCount = clamp(out.retryCount, 0, 20);
  out.threadCount = clamp(out.threadCount, 1, 16);
  if (out.peakHoursStart < 0 || out.peakHoursStart > 23) out.peakHoursStart = 9;
  if (out.peakHoursEnd < 0 || out.peakHoursEnd > 23) out.peakHoursEnd = 17;
  return out;
}

function clamp(v: number, min: number, max: number): number {
  const n = Math.trunc(Number.isFinite(v) ? v : min);
  return Math.min(max, Math.max(min, n));
}

/** Port of AppSettings.Load() */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const rows = await getDb()
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].data) as Partial<AppSettings>;
      return validateAndFix({ ...DEFAULT_SETTINGS, ...parsed });
    }
  } catch {
    // corrupted/missing settings -> defaults (same as the original)
  }
  return { ...DEFAULT_SETTINGS };
}

/** Port of AppSettings.Save() */
export async function saveSettings(s: AppSettings): Promise<void> {
  const fixed = validateAndFix(s);
  const data = JSON.stringify(fixed, null, 2);
  // Race-safe upsert (the app is single-row, and concurrent saves must not fail)
  await getDb()
    .insert(appSettings)
    .values({ id: 1, data })
    .onDuplicateKeyUpdate({ set: { data, updatedAt: new Date() } });
}
