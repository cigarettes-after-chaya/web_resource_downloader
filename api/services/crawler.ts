import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { ResumeMode, type AppSettings } from "@contracts/types";

/**
 * Web reconstruction of the original app's wget engine (WgetDownloader).
 *
 * The desktop app shelled out to an embedded wget.exe with:
 *   -r -p -e robots=off -U <ua> [-k] [-E] [-l n] [-w n] [--limit-rate=x]
 *   [-c|-N|-nc] [--no-check-certificate] [--connect-timeout] [--read-timeout]
 *   [--tries=n] <url> -P ./<host>
 *
 * This module reproduces that behavior in Node: recursive same-host crawl,
 * page requisites (cross-host), depth/wait/rate limits, resume modes,
 * link conversion for offline viewing, extension adjustment, and wget-style
 * log output (which the UI classifies with the original regexes).
 */

export interface CrawlCallbacks {
  log(message: string): void;
  isCancelled(): boolean;
}

export interface CrawlResult {
  success: boolean;
  cancelled: boolean;
  exitCode: number;
  filesDownloaded: number;
  bytesDownloaded: number;
  outputDir: string;
  host: string;
}

// Safety caps for the shared server environment (not present in the desktop
// original, which wrote straight to the user's own disk).
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 10;

const ANALYTICS_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "googlesyndication.com",
  "doubleclick.net",
  "facebook.net",
  "connect.facebook.net",
  "hotjar.com",
  "segment.com",
  "segment.io",
  "mixpanel.com",
  "clarity.ms",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "matomo",
  "plausible.io",
];
const ANALYTICS_INLINE =
  /GoogleAnalyticsObject|gtag\s*\(|ga\s*\(\s*['"]create|fbq\s*\(|_hjSettings|mixpanel\.|clarity\s*\(/;

interface QueueItem {
  url: string;
  depth: number;
  kind: "page" | "requisite";
}

interface FetchResponse {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
}

function ts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Parses "500k" / "2m" / "1g" / "2000" into bytes/sec (0 = unlimited). */
export function parseRateLimit(input: string): number {
  const m = /^(\d+)([kmg])?$/i.exec(input.trim());
  if (!m) return 0;
  const mult = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    (m[2] ?? "").toLowerCase() as "k" | "m" | "g"
  ] ?? 1;
  return parseInt(m[1], 10) * mult;
}

function formatBytesWget(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}`;
}

/** Shared token-bucket rate limiter across workers. */
class RateLimiter {
  private bytesPerSec: number;
  private allowance: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(bytesPerSec: number) {
    this.bytesPerSec = bytesPerSec;
    this.allowance = bytesPerSec;
    this.last = Date.now();
  }

  take(bytes: number): Promise<void> {
    if (this.bytesPerSec <= 0) return Promise.resolve();
    const run = async () => {
      const now = Date.now();
      this.allowance = Math.min(
        this.bytesPerSec,
        this.allowance + ((now - this.last) / 1000) * this.bytesPerSec,
      );
      this.last = now;
      if (this.allowance >= bytes) {
        this.allowance -= bytes;
        return;
      }
      const deficit = bytes - this.allowance;
      this.allowance = 0;
      const waitMs = (deficit / this.bytesPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

export class Crawler {
  private visited = new Set<string>();
  private queue: QueueItem[] = [];
  private active: http.ClientRequest[] = [];
  private savedFiles = new Map<string, string>(); // absolute url -> abs local path
  private htmlFiles: string[] = [];
  private cssFiles: string[] = [];
  private limiter: RateLimiter;
  private host: string;
  private filesDownloaded = 0;
  private bytesDownloaded = 0;
  private httpErrors = 0;
  private rootSaved = false;
  private limitWarned = false;

  private options: {
    url: string;
    outputDir: string;
    settings: AppSettings;
    rateLimit: string; // effective rate limit after scheduling
  };
  private cb: CrawlCallbacks;

  constructor(
    options: Crawler["options"],
    cb: CrawlCallbacks,
  ) {
    this.options = options;
    this.cb = cb;
    this.host = new URL(options.url).host;
    this.limiter = new RateLimiter(parseRateLimit(options.rateLimit));
  }

  cancel(): void {
    for (const req of this.active.splice(0)) {
      try {
        req.destroy(new CancelledError());
      } catch {
        /* noop */
      }
    }
  }

  private log(msg: string) {
    this.cb.log(msg);
  }

  private checkCancelled() {
    if (this.cb.isCancelled()) throw new CancelledError();
  }

  async run(): Promise<CrawlResult> {
    const s = this.options.settings;
    const workers = s.enableMultiThreaded ? Math.max(1, s.threadCount) : 1;
    this.queue.push({ url: this.options.url, depth: 0, kind: "page" });

    try {
      await Promise.all(
        Array.from({ length: workers }, () => this.worker()),
      );
    } catch (e) {
      if (!(e instanceof CancelledError)) throw e;
    }

    const cancelled = this.cb.isCancelled();
    if (!cancelled && s.convertLinksForOffline) {
      this.convertLinks();
    }

    return {
      success: this.rootSaved && !cancelled,
      cancelled,
      exitCode: this.httpErrors > 0 ? 8 : 0,
      filesDownloaded: this.filesDownloaded,
      bytesDownloaded: this.bytesDownloaded,
      outputDir: this.options.outputDir,
      host: this.host,
    };
  }

  private async worker(): Promise<void> {
    const s = this.options.settings;
    for (;;) {
      this.checkCancelled();
      const item = this.queue.shift();
      if (!item) {
        // No item right now; another worker may still enqueue requisites.
        await new Promise((r) => setTimeout(r, 60));
        if (this.queue.length === 0 && !this.anyActive()) return;
        continue;
      }
      const key = normalizeUrl(item.url);
      if (this.visited.has(key)) continue;
      this.visited.add(key);

      if (this.filesDownloaded >= MAX_FILES || this.bytesDownloaded >= MAX_TOTAL_BYTES) {
        if (!this.limitWarned) {
          this.limitWarned = true;
          this.log(
            `WARNING: safety limit reached (${MAX_FILES} files / ${formatBytesWget(MAX_TOTAL_BYTES)}), no further files will be queued`,
          );
        }
        continue;
      }

      if (s.waitBetweenRequests > 0) {
        await sleep(s.waitBetweenRequests * 1000);
      }
      await this.fetchAndSave(item);
    }
  }

  private activeFetches = 0;
  private anyActive(): boolean {
    return this.activeFetches > 0;
  }

  private async fetchAndSave(item: QueueItem): Promise<void> {
    const s = this.options.settings;
    this.activeFetches++;
    try {
      const u = new URL(item.url);
      this.log(`--${ts()}--  ${item.url}`);

      // Resume-mode handling (skip checks happen before the request)
      const guess = urlToLocalPath(u, null, s.adjustExtensions);
      const absPath = path.join(this.options.outputDir, guess.rel);
      if (s.resumeMode === ResumeMode.NoClobber && fs.existsSync(absPath)) {
        this.log(`File '${guess.rel}' already there; not retrieving.`);
        this.registerSaved(item.url, absPath);
        return;
      }
      if (s.resumeMode === ResumeMode.Timestamping && fs.existsSync(absPath)) {
        const fresh = await this.checkNotModified(u, absPath);
        if (fresh) {
          this.log(`Server file no newer than local file '${guess.rel}' -- not retrieving.`);
          this.registerSaved(item.url, absPath);
          return;
        }
      }

      const resp = await this.fetchWithRetries(u);
      if (!resp) return; // error already logged

      this.log(
        `HTTP request sent, awaiting response... ${resp.status} ${resp.statusText}`,
      );
      if (resp.status >= 400) {
        this.httpErrors++;
        this.log(`ERROR ${resp.status}: ${resp.statusText}.`);
        return;
      }
      if (resp.status === 304) {
        this.registerSaved(item.url, absPath);
        return;
      }

      const contentType = String(resp.headers["content-type"] ?? "");
      this.log(
        `Length: ${resp.body.length} (${formatBytesWget(resp.body.length)}) [${contentType.split(";")[0] || "application/octet-stream"}]`,
      );

      const finalU = new URL(resp.finalUrl);
      const local = urlToLocalPath(finalU, contentType, s.adjustExtensions);
      const target = path.join(this.options.outputDir, local.rel);
      let body = resp.body;
      const isHtml = /text\/html|application\/xhtml/i.test(contentType);
      const isCss = /text\/css/i.test(contentType) || /\.css$/i.test(finalU.pathname);

      if (isHtml && s.stripAnalyticsScripts) {
        body = Buffer.from(stripAnalytics(body.toString("utf8")), "utf8");
      }

      this.saveFile(target, body, local.rel);
      this.registerSaved(resp.finalUrl, target);
      if (normalizeUrl(resp.finalUrl) !== normalizeUrl(item.url)) {
        this.registerSaved(item.url, target);
      }
      if (isHtml) this.htmlFiles.push(target);
      if (isCss) this.cssFiles.push(target);

      if (item.kind === "page" && normalizeUrl(item.url) === normalizeUrl(this.options.url)) {
        this.rootSaved = true;
      }

      // Discovery
      if (isHtml) {
        const canFollowLinks =
          item.kind === "page" &&
          (s.maxDepth === 0 || item.depth < s.maxDepth);
        const discovered = extractLinks(body.toString("utf8"), resp.finalUrl);
        for (const link of discovered.requisites) {
          this.enqueue({ url: link, depth: item.depth + 1, kind: "requisite" });
        }
        if (canFollowLinks) {
          for (const link of discovered.pages) {
            if (new URL(link).host === this.host) {
              this.enqueue({ url: link, depth: item.depth + 1, kind: "page" });
            }
          }
        }
      } else if (isCss) {
        for (const link of extractCssUrls(body.toString("utf8"), resp.finalUrl)) {
          this.enqueue({ url: link, depth: item.depth + 1, kind: "requisite" });
        }
      }
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      this.httpErrors++;
      this.log(errorToWgetLine(e));
    } finally {
      this.activeFetches--;
    }
  }

  private enqueue(item: QueueItem) {
    try {
      new URL(item.url);
      if (this.filesDownloaded + this.queue.length >= MAX_FILES) return;
      this.queue.push(item);
    } catch {
      /* invalid URL */
    }
  }

  private async checkNotModified(u: URL, absPath: string): Promise<boolean> {
    try {
      const mtime = fs.statSync(absPath).mtime;
      const resp = await this.request(u, {
        method: "HEAD",
        headers: { "If-Modified-Since": mtime.toUTCString() },
      });
      if (resp.status === 304) return true;
      const lastMod = resp.headers["last-modified"];
      if (lastMod && new Date(lastMod) <= mtime) return true;
      return false;
    } catch {
      return false; // cannot verify -> re-download
    }
  }

  private async fetchWithRetries(u: URL): Promise<FetchResponse | null> {
    const s = this.options.settings;
    const tries = Math.max(1, s.retryCount);
    for (let attempt = 1; attempt <= tries; attempt++) {
      this.checkCancelled();
      try {
        return await this.request(u, { method: "GET" });
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        if (attempt >= tries) throw e;
        this.log(`${errorToWgetLine(e)} Retrying.`);
        await sleep(1000);
      }
    }
    return null;
  }

  /** One HTTP request with redirects, decompression, timeouts, rate limiting. */
  private request(
    u: URL,
    opts: { method: "GET" | "HEAD"; headers?: Record<string, string> },
    redirectsLeft = MAX_REDIRECTS,
  ): Promise<FetchResponse> {
    const s = this.options.settings;
    return new Promise<FetchResponse>((resolve, reject) => {
      const isHttps = u.protocol === "https:";
      const mod = isHttps ? https : http;
      const req = mod.request(
        u,
        {
          method: opts.method,
          rejectUnauthorized: !s.ignoreSslErrors,
          headers: {
            "User-Agent": s.userAgent,
            Accept: "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "close",
            ...(opts.headers ?? {}),
          },
        },
        (res) => {
          void (async () => {
            try {
              // Follow redirects like wget
              if (
                [301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
                res.headers.location &&
                redirectsLeft > 0
              ) {
                res.resume();
                const next = new URL(res.headers.location, u);
                this.log(`Location: ${next} [following]`);
                resolve(await this.request(next, opts, redirectsLeft - 1));
                return;
              }

              const status = res.statusCode ?? 0;
              const statusText = res.statusMessage ?? "";
              if (opts.method === "HEAD") {
                res.resume();
                resolve({
                  status,
                  statusText,
                  headers: res.headers,
                  body: Buffer.alloc(0),
                  finalUrl: u.toString(),
                });
                return;
              }

              let stream: NodeJS.ReadableStream = res;
              const enc = String(res.headers["content-encoding"] ?? "");
              if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
              else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
              else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

              const limited: Buffer[] = [];
              let total = 0;
              const iterator = async () => {
                for await (const chunk of stream as AsyncIterable<Buffer>) {
                  this.checkCancelled();
                  await this.limiter.take(chunk.length);
                  limited.push(chunk);
                  total += chunk.length;
                  if (total > MAX_FILE_BYTES) {
                    throw new Error("failed: file exceeds size limit");
                  }
                }
              };
              iterator()
                .then(() => {
                  resolve({
                    status,
                    statusText,
                    headers: res.headers,
                    body: Buffer.concat(limited),
                    finalUrl: u.toString(),
                  });
                })
                .catch(reject);
            } catch (e) {
              reject(e);
            }
          })();
        },
      );

      this.active.push(req);
      req.on("close", () => {
        const i = this.active.indexOf(req);
        if (i >= 0) this.active.splice(i, 1);
      });
      req.on("error", (e) => reject(e));

      // Connection timeout, then read timeout once connected
      const connTimer = setTimeout(() => {
        req.destroy(Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" }));
      }, s.connectionTimeout * 1000);
      req.on("socket", (socket) => {
        socket.on("secureConnect", clear);
        socket.on("connect", clear);
        function clear() {
          clearTimeout(connTimer);
          socket.setTimeout(s.readTimeout * 1000, () => {
            req.destroy(Object.assign(new Error("Read timed out"), { code: "ETIMEDOUT" }));
          });
        }
      });

      req.end();
    });
  }

  private saveFile(absPath: string, body: Buffer, rel: string) {
    this.checkCancelled();
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    // Continue mode: resume a partial download is emulated by writing the full
    // body; the web engine always receives complete responses.
    fs.writeFileSync(absPath, body);
    this.log(`Saving to: '${rel}'`);
    this.log(`'${rel}' saved [${body.length}/${body.length}]`);
    this.filesDownloaded++;
    this.bytesDownloaded += body.length;
  }

  private registerSaved(url: string, absPath: string) {
    this.savedFiles.set(normalizeUrl(url), absPath);
  }

  /** wget -k: rewrite links in saved HTML/CSS to relative local paths. */
  private convertLinks() {
    const s = this.options.settings;
    if (!s.convertLinksForOffline) return;
    // reverse lookup: local file -> original absolute URL (document base)
    const baseOf = new Map<string, string>();
    for (const [url, file] of this.savedFiles) {
      if (!baseOf.has(file)) baseOf.set(file, url);
    }
    let converted = 0;
    for (const file of this.htmlFiles) {
      try {
        const base = baseOf.get(file) ?? this.options.url;
        const original = fs.readFileSync(file, "utf8");
        const rewritten = rewriteHtmlLinks(original, base, (target) =>
          this.toRelativeLink(file, target),
        );
        if (rewritten !== original) {
          fs.writeFileSync(file, rewritten);
          converted++;
        }
        this.log(`Converting links in ${path.relative(this.options.outputDir, file)}... done.`);
      } catch {
        /* leave file as-is */
      }
    }
    for (const file of this.cssFiles) {
      try {
        const base = baseOf.get(file) ?? this.options.url;
        const original = fs.readFileSync(file, "utf8");
        const rewritten = rewriteCssLinks(original, base, (target) =>
          this.toRelativeLink(file, target),
        );
        if (rewritten !== original) fs.writeFileSync(file, rewritten);
      } catch {
        /* leave file as-is */
      }
    }
    this.log(`Converted links in ${converted} files.`);
  }

  private toRelativeLink(fromFile: string, targetUrl: string): string | null {
    const saved = this.savedFiles.get(normalizeUrl(targetUrl));
    if (!saved) return null;
    let rel = path.relative(path.dirname(fromFile), saved);
    rel = rel.split(path.sep).join("/");
    return rel;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Strip fragment + trailing default marks, like wget's file dedup key. */
function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

/** wget-like error line that the UI's original regexes classify as errors. */
function errorToWgetLine(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  const code = err?.code ?? "";
  const msg = err?.message ?? String(e);
  if (code === "ECONNREFUSED") return `failed: Connection refused.`;
  if (code === "ETIMEDOUT") return `failed: Connection timed out.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return `failed: Name or service not known (${msg}).`;
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "CERT_HAS_EXPIRED")
    return `ERROR: cannot verify certificate: ${msg}`;
  if (msg.includes("certificate")) return `ERROR: certificate error: ${msg}`;
  return `failed: ${msg}.`;
}

const FS_FORBIDDEN = /[<>:"|?*\x00-\x1f]/g;

function sanitizeSegment(seg: string): string {
  return seg.replace(FS_FORBIDDEN, "_").slice(0, 120) || "_";
}

/**
 * Maps a URL to its local path the way wget does with -P ./<host>:
 * host directory, path segments, index.html for directory URLs,
 * query string folded into the file name, optional -E extension adjustment.
 */
export function urlToLocalPath(
  u: URL,
  contentType: string | null,
  adjustExtensions: boolean,
): { hostDir: string; rel: string } {
  const hostDir = sanitizeSegment(u.host.replace(/:/g, "_"));
  const rawSegments = u.pathname.split("/").filter(Boolean);
  const segments = rawSegments.map((s) => sanitizeSegment(decodeURIComponent(s)));
  let file = "";
  if (segments.length === 0 || u.pathname.endsWith("/")) {
    file = "index.html";
  } else {
    file = segments.pop()!;
  }
  if (u.search) {
    const q = sanitizeSegment(u.search.slice(1));
    if (q) file = `${file}_${q.slice(0, 60)}`;
  }
  const isHtmlType = contentType != null && /text\/html|application\/xhtml/i.test(contentType);
  if (adjustExtensions && isHtmlType && !/\.(html?|php|aspx?|jsp)$/i.test(file)) {
    file += ".html";
  } else if (
    contentType == null &&
    adjustExtensions &&
    !/\.[a-z0-9]{1,8}$/i.test(file)
  ) {
    // Pre-request guess: leave as-is; final mapping happens with the real type.
  }
  return { hostDir, rel: [hostDir, ...segments, file].join(path.sep) };
}

// ---------------------------------------------------------------------------
// Link extraction (no full parser dependency on the hot path)
// ---------------------------------------------------------------------------

const ATTR_RE = /\b(href|src|action)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRCSET_RE = /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi;
const PAGE_ATTR_TAGS = /<(?:a|area)\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_RE = /url\(\s*("([^"]*)"|'([^']*)'|([^)"'][^)]*))\s*\)/gi;

function isSkippableScheme(u: string): boolean {
  return /^(?:#|javascript:|mailto:|tel:|data:|about:|blob:)/i.test(u.trim());
}

export function extractLinks(
  html: string,
  baseUrl: string,
): { pages: string[]; requisites: string[] } {
  const pages = new Set<string>();
  const requisites = new Set<string>();
  const resolve = (raw: string): string | null => {
    const t = raw.trim();
    if (!t || isSkippableScheme(t)) return null;
    try {
      return new URL(t, baseUrl).toString();
    } catch {
      return null;
    }
  };

  // page links: <a href> / <area href>
  for (const m of html.matchAll(PAGE_ATTR_TAGS)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    const abs = resolve(raw);
    if (abs) pages.add(abs);
  }
  // requisites: everything else with src/href/action
  for (const m of html.matchAll(ATTR_RE)) {
    const raw = m[3] ?? m[4] ?? m[5] ?? "";
    const abs = resolve(raw);
    if (abs) requisites.add(abs);
  }
  // srcset
  for (const m of html.matchAll(SRCSET_RE)) {
    const value = m[2] ?? m[3] ?? "";
    for (const part of value.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (!url) continue;
      const abs = resolve(url);
      if (abs) requisites.add(abs);
    }
  }
  // inline style url(...)
  for (const m of html.matchAll(CSS_URL_RE)) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    const abs = resolve(raw);
    if (abs) requisites.add(abs);
  }
  return { pages: [...pages], requisites: [...requisites] };
}

export function extractCssUrls(css: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(CSS_URL_RE)) {
    const raw = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!raw || isSkippableScheme(raw)) continue;
    try {
      out.add(new URL(raw, baseUrl).toString());
    } catch {
      /* skip */
    }
  }
  // @import "..."
  for (const m of css.matchAll(/@import\s+(?:url\()?\s*("([^"]*)"|'([^']*)')/gi)) {
    const raw = m[2] ?? m[3] ?? "";
    try {
      out.add(new URL(raw, baseUrl).toString());
    } catch {
      /* skip */
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Link rewriting for offline viewing (wget -k)
// ---------------------------------------------------------------------------

export function rewriteHtmlLinks(
  html: string,
  baseUrl: string,
  toLocal: (absoluteUrl: string) => string | null,
): string {
  return html.replace(
    /\b(href|src|action|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (whole, attr: string, _v: string, dq: string, sq: string, bare: string) => {
      const raw = (dq ?? sq ?? bare ?? "").trim();
      if (!raw || isSkippableScheme(raw)) return whole;
      const quote = dq != null ? '"' : sq != null ? "'" : "";
      if (attr.toLowerCase() === "srcset") {
        const rewritten = raw
          .split(",")
          .map((part) => {
            const bits = part.trim().split(/\s+/);
            const url = bits[0];
            if (!url || isSkippableScheme(url)) return part;
            const local = resolveToLocal(url, baseUrl, toLocal);
            if (!local) return part;
            bits[0] = local;
            return bits.join(" ");
          })
          .join(", ");
        return `${attr}=${quote}${rewritten}${quote}`;
      }
      const local = resolveToLocal(raw, baseUrl, toLocal);
      if (!local) return whole;
      return quote ? `${attr}=${quote}${local}${quote}` : `${attr}=${local}`;
    },
  );
}

export function rewriteCssLinks(
  css: string,
  baseUrl: string,
  toLocal: (absoluteUrl: string) => string | null,
): string {
  return css.replace(CSS_URL_RE, (whole, _g: string, dq: string, sq: string, bare: string) => {
    const raw = (dq ?? sq ?? bare ?? "").trim();
    if (!raw || isSkippableScheme(raw)) return whole;
    const local = resolveToLocal(raw, baseUrl, toLocal);
    if (!local) return whole;
    return `url("${local}")`;
  });
}

function resolveToLocal(
  raw: string,
  baseUrl: string,
  toLocal: (absoluteUrl: string) => string | null,
): string | null {
  let abs: string;
  try {
    abs = new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
  return toLocal(abs);
}

// ---------------------------------------------------------------------------
// Analytics stripping (Playwright engine option in the original app)
// ---------------------------------------------------------------------------

export function stripAnalytics(html: string): string {
  return html.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (whole) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(whole);
      if (srcMatch && ANALYTICS_HOSTS.some((h) => srcMatch[1].includes(h))) {
        return "";
      }
      if (!srcMatch && ANALYTICS_INLINE.test(whole)) {
        return "";
      }
      return whole;
    },
  );
}
