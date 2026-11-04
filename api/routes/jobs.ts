import { Hono } from "hono";
import { getJobStatus } from "../services/jobs";

/**
 * Polling endpoint for live job status/log streaming.
 * GET /api/jobs/:id/status?cursor=N
 */
export const jobsRoutes = new Hono();

jobsRoutes.get("/:id/status", (c) => {
  const cursor = Number(c.req.query("cursor") ?? "0");
  const status = getJobStatus(c.req.param("id"), Number.isFinite(cursor) ? cursor : 0);
  if (!status) return c.json({ error: "Not Found" }, 404);
  return c.json(status);
});
