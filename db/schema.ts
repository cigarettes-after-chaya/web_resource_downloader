import {
  mysqlTable,
  serial,
  int,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/mysql-core";

/** Single-row table (id = 1) holding the AppSettings JSON, mirroring settings.json */
export const appSettings = mysqlTable("app_settings", {
  id: int("id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Mirrors history.json (DownloadHistory, max 50 items, newest first) */
export const downloadHistory = mysqlTable("download_history", {
  id: serial("id").primaryKey(),
  url: varchar("url", { length: 2048 }).notNull(),
  outputFolder: varchar("output_folder", { length: 1024 }).notNull(),
  downloadDate: timestamp("download_date").notNull().defaultNow(),
  durationSec: int("duration_sec").notNull().default(0),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
});
