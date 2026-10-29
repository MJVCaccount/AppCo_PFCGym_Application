#!/usr/bin/env node
/**
 * Production rollback through the Vercel REST API.
 *
 * The Vercel CLI cannot be used for this: the deployment token has no user
 * record, so some CLI commands fail with "User not found". The REST API accepts
 * the same token, so this script talks to it directly.
 *
 *   node scripts/ci/vercel-rollback.mjs current          print the live production deployment id
 *   node scripts/ci/vercel-rollback.mjs previous         print the one before it
 *   node scripts/ci/vercel-rollback.mjs promote <id>     make <id> the live production deployment
 *   node scripts/ci/vercel-rollback.mjs ready [url]      poll /api/health/ready until it answers 200
 *   node scripts/ci/vercel-rollback.mjs rollback <id>    promote <id>, wait until it is live, verify readiness
 *   node scripts/ci/vercel-rollback.mjs drill            roll back to the previous release and forward again
 *
 * Environment: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID (the team), and
 * optionally VERCEL_AUTOMATION_BYPASS_SECRET (sent as x-vercel-protection-bypass).
 *
 * Migrations are forward-only. A rollback puts the previous CODE back; the
 * database stays on the newer schema. That is safe because every migration must
 * be backward compatible with the release before it (see deploy.yml).
 *
 * The token and the bypass secret are never printed, and error output carries
 * the HTTP status and Vercel's error code, not the response body.
 */
import { pathToFileURL } from "node:url";

const DEFAULT_API = "https://api.vercel.com";

/** @param {Record<string, string | undefined>} [env] */
export function apiBase(env = process.env) {
  const base = (env.VERCEL_API ?? DEFAULT_API).replace(/\/+$/, "");
  // An override exists only so the tests can aim at a local fake. Anything
  // else would send the token somewhere it should not go.
  if (base !== DEFAULT_API && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
    throw new Error("VERCEL_API may only be the Vercel API or a local test server.");
  }
  return base;
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

// Vercel answers a promotion with 409 while the previous one is still settling.
const PROMOTE_RETRIES = 6;
const PROMOTE_WAIT_MS = 5000;
const MAX_RETRY_AFTER_MS = 30000;

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ sleep?: (ms: number) => Promise<void> }} [options]
 */
export function client(env = process.env, { sleep: wait = sleep } = {}) {
  const base = apiBase(env);
  const token = required(env, "VERCEL_TOKEN");
  const projectId = required(env, "VERCEL_PROJECT_ID");
  const teamId = required(env, "VERCEL_ORG_ID");

  async function request(method, path, query = {}) {
    const url = new URL(base + path);
    url.searchParams.set("teamId", teamId);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });

    if (!response.ok) {
      let code = "";
      try {
        code = (await response.json())?.error?.code ?? "";
      } catch {
        // not JSON
      }
      // Only the status and Vercel's error code are kept: never a body or a token.
      const error = new Error(`Vercel API ${method} ${path.split("?")[0]} answered ${response.status}${code ? ` (${code})` : ""}.`);
      error.status = response.status;
      const seconds = Number(response.headers.get("retry-after"));
      error.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
      throw error;
    }
    return response.status === 204 ? {} : response.json().catch(() => ({}));
  }

  return {
    /** The live production deployment: { id, url, domains }. */
    async current() {
      const project = await request("GET", `/v9/projects/${projectId}`);
      const target = project?.targets?.production;
      if (!target?.id) throw new Error("The project has no production deployment.");
      return { id: target.id, url: target.url ?? "", domains: target.alias ?? [] };
    },

    /** Ready production deployments, newest first. */
    async readyProduction(limit = 5) {
      const data = await request("GET", "/v6/deployments", {
        projectId,
        target: "production",
        state: "READY",
        limit,
      });
      return (data.deployments ?? []).map((d) => ({ id: d.uid, url: d.url, created: d.created }));
    },

    /** A 409 is retried up to PROMOTE_RETRIES times; every other failure is final. */
    async promote(deploymentId) {
      for (let retry = 0; ; retry++) {
        try {
          await request("POST", `/v10/projects/${projectId}/promote/${encodeURIComponent(deploymentId)}`);
          return;
        } catch (error) {
          if (error.status !== 409 || retry >= PROMOTE_RETRIES) throw error;
          await wait(error.retryAfterMs ?? PROMOTE_WAIT_MS);
        }
      }
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls GET <base>/api/health/ready until it is 200 {status: ok}.
 * @param {string} baseUrl
 * @param {{ tries?: number, delayMs?: number, env?: Record<string, string | undefined> }} [options]
 */
export async function waitReady(baseUrl, { tries = 12, delayMs = 5000, env = process.env } = {}) {
  const headers = {};
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  let last = "no answer";
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(new URL("/api/health/ready", baseUrl), { headers });
      const body = await response.json().catch(() => ({}));
      if (response.status === 200 && body.status === "ok") return { ok: true, attempts: attempt };
      last = `status ${response.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : "request failed";
    }
    if (attempt < tries) await sleep(delayMs);
  }
  return { ok: false, attempts: tries, reason: last };
}

/**
 * Promotes `id`, waits until the project reports it live, then checks readiness on the production domain.
 * @param {ReturnType<typeof client>} api
 * @param {string} id
 * @param {{ env?: Record<string, string | undefined>, pollMs?: number, polls?: number, ready?: (url: string, options: { env?: Record<string, string | undefined> }) => Promise<{ ok: boolean, reason?: string, attempts?: number }> }} [options]
 */
export async function rollback(api, id, { env = process.env, pollMs = 3000, polls = 20, ready = waitReady } = {}) {
  await api.promote(id);

  let live = null;
  for (let i = 0; i < polls; i++) {
    live = await api.current();
    if (live.id === id) break;
    await sleep(pollMs);
  }
  if (!live || live.id !== id) {
    return { ok: false, step: "promote", detail: `the project still serves ${live?.id ?? "nothing"} after ${polls} checks` };
  }

  const host = live.domains[0];
  const target = host ? `https://${host}` : `https://${live.url}`;
  const check = await ready(target, { env });
  return check.ok
    ? { ok: true, id, url: target }
    : { ok: false, step: "ready", detail: `readiness on ${target} failed: ${check.reason}` };
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  const api = client();

  switch (command) {
    case "current": {
      console.log((await api.current()).id);
      return;
    }
    case "previous": {
      const [, previous] = await api.readyProduction(2);
      if (!previous) throw new Error("There is no earlier production deployment.");
      console.log(previous.id);
      return;
    }
    case "promote": {
      if (!argument) throw new Error("promote needs a deployment id.");
      await api.promote(argument);
      console.log(`promoted ${argument}`);
      return;
    }
    case "ready": {
      const base = argument ?? (await api.current()).domains[0] ?? "";
      const result = await waitReady(base.startsWith("http") ? base : `https://${base}`);
      console.log(result.ok ? `ready after ${result.attempts} attempt(s)` : `NOT READY: ${result.reason}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "rollback": {
      if (!argument) throw new Error("rollback needs the deployment id to go back to.");
      const result = await rollback(api, argument);
      console.log(result.ok ? `rolled back to ${result.id}; ${result.url} is ready` : `ROLLBACK FAILED at ${result.step}: ${result.detail}`);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "drill": {
      const started = Date.now();
      const before = await api.current();
      const [, previous] = await api.readyProduction(2);
      if (!previous) throw new Error("There is no earlier production deployment to drill with.");

      console.log(`live now: ${before.id}; drilling back to ${previous.id}`);
      const back = await rollback(api, previous.id);
      console.log(back.ok ? `step 1 ok: ${previous.id} is live and ready` : `step 1 FAILED at ${back.step}: ${back.detail}`);

      // Always put the release that was live back, even if step 1 failed.
      const forward = await rollback(api, before.id);
      console.log(forward.ok ? `step 2 ok: ${before.id} is live again and ready` : `step 2 FAILED at ${forward.step}: ${forward.detail}`);

      console.log(`drill took ${Math.round((Date.now() - started) / 1000)} s`);
      process.exitCode = back.ok && forward.ok ? 0 : 1;
      return;
    }
    default:
      throw new Error("Usage: vercel-rollback.mjs current|previous|promote <id>|ready [url]|rollback <id>|drill");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "failed");
    process.exit(1);
  });
}
