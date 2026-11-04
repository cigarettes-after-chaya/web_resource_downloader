import type { UpdateCheckResult } from "@contracts/types";

/**
 * Port of UpdateChecker (original checked the GitHub releases API of
 * badrshs/Complete-Website-Downloader every 7 days).
 */
const CURRENT_VERSION = "1.0.0";
const RELEASES_API =
  "https://api.github.com/repos/badrshs/Complete-Website-Downloader/releases/latest";
export const UPDATE_CHECK_INTERVAL_DAYS = 7;

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    currentVersion: CURRENT_VERSION,
    latestVersion: CURRENT_VERSION,
    updateAvailable: false,
    releaseUrl: "",
    releaseNotes: "",
    errorMessage: null,
  };
  try {
    const res = await fetch(RELEASES_API, {
      headers: { "User-Agent": "WebsiteDownloader", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const json = (await res.json()) as {
      tag_name?: string;
      body?: string;
      html_url?: string;
    };
    const tag = (json.tag_name ?? "").replace(/^[vV]/, "");
    const latest = parseVersion(tag);
    if (!latest) {
      result.errorMessage = "Could not parse version information";
      return result;
    }
    result.latestVersion = latest.join(".");
    result.releaseUrl = json.html_url ?? "";
    result.releaseNotes = json.body ?? "";
    result.updateAvailable = compareVersions(latest, parseVersion(CURRENT_VERSION)!) > 0;
    return result;
  } catch (e) {
    result.errorMessage = e instanceof Error ? e.message : String(e);
    return result;
  }
}

function parseVersion(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Port of UpdateChecker.ShouldCheckForUpdates */
export function shouldCheckForUpdates(lastCheckIso: string | null): boolean {
  if (!lastCheckIso) return true;
  const last = new Date(lastCheckIso).getTime();
  if (Number.isNaN(last)) return true;
  return (Date.now() - last) / 86400000 >= UPDATE_CHECK_INTERVAL_DAYS;
}
