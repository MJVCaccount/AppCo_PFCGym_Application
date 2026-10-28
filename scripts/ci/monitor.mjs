#!/usr/bin/env node
/**
 * Production monitor, run every 15 minutes by .github/workflows/monitor.yml.
 *
 *   MONITOR_URL=https://... [HEALTH_TOKEN=...] node scripts/ci/monitor.mjs
 *
 * Checks readiness and response time, and, when HEALTH_TOKEN is set, the
 * health-detail thresholds: database size, failed email, pending migrations,
 * and whether the daily maintenance job is still running. Prints one JSON
 * object on the last line:
 *
 *   { "ok": true|false, "problems": ["..."], "facts": {...} }
 *
 * The workflow turns that into one GitHub issue labelled "incident": opened on
 * the first failure, updated while it lasts, closed on recovery. Nothing here
 * prints a token or a response body.
 */
import { pathToFileURL } from "node:url";

/** Where the alarms go off. Neon's free database is 0.5 GB; Resend's free plan is 100 emails a day. */
export const THRESHOLDS = {
  readyMs: 3000,
  databaseBytes: 400 * 1024 * 1024,
  pendingEmails: 20,
  sentLast24h: 95,
  deadLast24h: 3,
  latencyMs: 1500,
  maintenanceHours: 36,
};

/** Turns what was measured into a list of plain-sentence problems. Pure. */
export function evaluate({ ready, detail }, now = new Date(), t = THRESHOLDS) {
  const problems = [];

  if (!ready.ok) {
    problems.push(`Readiness check failed (${ready.reason}).`);
  } else if (ready.ms > t.readyMs) {
    problems.push(`Readiness took ${ready.ms} ms (limit ${t.readyMs} ms).`);
  }

  if (detail === undefined) return problems; // no token configured: only the public checks

  if (detail === null) {
    problems.push("The health detail could not be read (wrong or missing token, or the route is down).");
    return problems;
  }

  const d = detail;
  if (d.status === "degraded") problems.push("Health detail reports degraded.");
  if (d.database.migrations.pending.length > 0) {
    problems.push(`Migrations not applied: ${d.database.migrations.pending.join(", ")}.`);
  }
  if (d.database.sizeBytes > t.databaseBytes) {
    problems.push(`Database is ${Math.round(d.database.sizeBytes / 1048576)} MB (limit ${Math.round(t.databaseBytes / 1048576)} MB).`);
  }
  if (d.database.latencyMs > t.latencyMs) {
    problems.push(`Database latency is ${d.database.latencyMs} ms (limit ${t.latencyMs} ms).`);
  }
  if (d.outbox.deadLast24h > t.deadLast24h) {
    problems.push(`${d.outbox.deadLast24h} emails failed for good in the last 24 hours (limit ${t.deadLast24h}).`);
  }
  if (d.outbox.pending > t.pendingEmails) {
    problems.push(`${d.outbox.pending} emails are waiting to be sent (limit ${t.pendingEmails}).`);
  }
  if (d.outbox.sentLast24h > t.sentLast24h) {
    problems.push(`${d.outbox.sentLast24h} emails sent in 24 h, close to the provider's daily limit.`);
  }
  if (!d.configured.email) problems.push("Email is not configured on production.");

  const last = d.maintenance.lastRunAt ? new Date(d.maintenance.lastRunAt) : null;
  if (!last) {
    problems.push("The maintenance job has never run.");
  } else if (now.getTime() - last.getTime() > t.maintenanceHours * 3_600_000) {
    problems.push(`The maintenance job has not run in ${t.maintenanceHours} hours.`);
  }

  return problems;
}

/**
 * What to do with the incident issue. `existing` is the open issue's body or
 * null. Returns { action: "none" | "open" | "update" | "close", body }.
 */
export function decide(problems, existing, now = new Date()) {
  const stamp = now.toISOString();

  if (problems.length > 0) {
    const body = ["Production monitor found:", "", ...problems.map((p) => `- ${p}`), "", `Last checked: ${stamp}`].join("\n");
    if (existing === null) return { action: "open", body };

    const same = problemLines(existing).join("\n") === problems.map((p) => `- ${p}`).join("\n");
    return { action: same ? "none" : "update", body };
  }

  return existing === null
    ? { action: "none", body: "" }
    : { action: "close", body: `Recovered: every check passed at ${stamp}.` };
}

function problemLines(body) {
  return body.split("\n").filter((line) => line.startsWith("- "));
}

async function timedReady(base, headers) {
  const started = Date.now();
  try {
    const response = await fetch(new URL("/api/health/ready", base), { headers });
    const json = await response.json().catch(() => ({}));
    const ms = Date.now() - started;
    return response.status === 200 && json.status === "ok"
      ? { ok: true, ms }
      : { ok: false, ms, reason: `status ${response.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, reason: e instanceof Error ? e.message.slice(0, 80) : "no answer" };
  }
}

async function main() {
  const base = process.env.MONITOR_URL?.trim();
  if (!base) throw new Error("MONITOR_URL is not set.");

  const headers = {};
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  // One retry, so a single dropped request does not raise an incident.
  let ready = await timedReady(base, headers);
  if (!ready.ok) ready = await timedReady(base, headers);

  let detail;
  const token = process.env.HEALTH_TOKEN?.trim();
  if (token) {
    try {
      const response = await fetch(new URL("/api/health/detail", base), {
        headers: { ...headers, authorization: `Bearer ${token}` },
      });
      detail = response.status === 200 ? (await response.json()).data : null;
    } catch {
      detail = null;
    }
  }

  const problems = evaluate({ ready, detail });
  console.log(JSON.stringify({ ok: problems.length === 0, problems, facts: { readyMs: ready.ms, detailChecked: detail !== undefined } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "failed");
    process.exit(1);
  });
}
