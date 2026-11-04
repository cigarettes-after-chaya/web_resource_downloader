import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { ZIPS_DIR } from "../services/storage";

/**
 * Plain REST endpoints for file transfer (ZIP download of a finished job).
 * Registered in api/boot.ts above the /api/* 404 catch-all.
 */
export const filesRoutes = new Hono();

filesRoutes.get("/zip/:name", (c) => {
  const safe = path.basename(c.req.param("name"));
  const p = path.join(ZIPS_DIR, safe);
  if (!safe.endsWith(".zip") || !fs.existsSync(p)) {
    return c.json({ error: "Not Found" }, 404);
  }
  const size = fs.statSync(p).size;
  c.header("Content-Type", "application/zip");
  c.header("Content-Length", String(size));
  c.header("Content-Disposition", `attachment; filename="${safe}"`);
  const stream = fs.createReadStream(p);
  return new Response(
    new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) =>
          controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
        );
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    }),
    { headers: Object.fromEntries(c.res.headers.entries()) },
  );
});
