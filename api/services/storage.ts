import fs from "node:fs";
import path from "node:path";

/**
 * Managed download storage. The original desktop app let the user pick any
 * local folder; in the web reconstruction downloads live under a
 * server-managed data directory and the "output folder" is a named
 * subfolder of it.
 */
export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
export const ZIPS_DIR = path.join(DATA_DIR, "zips");

for (const dir of [DOWNLOADS_DIR, ZIPS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const FOLDER_NAME_PATTERN = /^[\w][\w .-]{0,63}$/;

export function isValidFolderName(name: string): boolean {
  return FOLDER_NAME_PATTERN.test(name) && !name.includes("..");
}

export function folderPath(name: string): string {
  if (!isValidFolderName(name)) throw new Error("Invalid folder name");
  return path.join(DOWNLOADS_DIR, name);
}

export function ensureFolder(name: string): string {
  const p = folderPath(name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function listFolders(): string[] {
  return fs
    .readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Format bytes like ZipResult.FormattedSize in the original app. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
