import { desc, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { downloadHistory } from "@db/schema";
import type { DownloadHistoryItem } from "@contracts/types";

/** AppConstants.MaxHistoryItems */
const MAX_HISTORY_ITEMS = 50;

export async function listHistory(): Promise<DownloadHistoryItem[]> {
  const rows = await getDb()
    .select()
    .from(downloadHistory)
    .orderBy(desc(downloadHistory.downloadDate), desc(downloadHistory.id))
    .limit(MAX_HISTORY_ITEMS);
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    outputFolder: r.outputFolder,
    downloadDate: r.downloadDate,
    durationSec: r.durationSec,
    success: r.success,
    errorMessage: r.errorMessage ?? null,
  }));
}

export async function addHistory(item: {
  url: string;
  outputFolder: string;
  durationSec: number;
  success: boolean;
  errorMessage: string | null;
}): Promise<void> {
  const db = getDb();
  await db.insert(downloadHistory).values({
    url: item.url,
    outputFolder: item.outputFolder,
    durationSec: Math.round(item.durationSec),
    success: item.success,
    errorMessage: item.errorMessage,
  });
  // Trim to the newest MAX_HISTORY_ITEMS entries (DownloadHistory.Add behavior)
  await db.execute(sql`
    DELETE FROM download_history
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id FROM download_history
        ORDER BY download_date DESC, id DESC
        LIMIT ${MAX_HISTORY_ITEMS}
      ) AS keep
    )
  `);
}

export async function clearHistory(): Promise<void> {
  await getDb().delete(downloadHistory);
}
