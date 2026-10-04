#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 *   npm run smoke -- <baseUrl> [--expect-seed]
 *
 * Node 20, built-in fetch only. SMOKE_BYPASS_SECRET (optional) is sent as the
 * x-vercel-protection-bypass header, for deployments behind Vercel's
 * Deployment Protection. Prints PASS or FAIL per check; exits 1 on any FAIL.
 * Only reads, plus two POSTs that must be refused: it changes nothing.
 */

const args = process.argv.slice(2);
const expectSeed = args.includes("--expect-seed");
const rawBase = args.find((a) => !a.startsWith("--"));

if (!rawBase) {
  process.stderr.write("Usage: npm run smoke -- <baseUrl> [--expect-seed]\n");
  process.exit(2);
}

const base = new URL(rawBase).origin;
const bypass = process.env.SMOKE_BYPASS_SECRET?.trim();
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  return fetch(path.startsWith("http") ? path : base + path, {
    redirect: "manual",
    ...options,
    headers,
  });
}

let failures = 0;

async function check(name, fn) {
  try {
    const problem = await fn();
    if (problem) throw new Error(problem);
    process.stdout.write(`PASS  ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(
      `FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

const expect = (condition, message) => (condition ? null : message);

await check("1a. /api/health is 200 {status: ok}", async () => {
  const response = await request("/api/health");
  const body = await response.json().catch(() => null);
  return expect(response.status === 200 && body?.status === "ok", `status ${response.status}, body ${JSON.stringify(body)}`);
});

await check("1b. /api/health/ready is 200 (database reachable)", async () => {
  const response = await request("/api/health/ready");
  return expect(response.status === 200, `status ${response.status}`);
});

await check("2. GET / is HTML with the security headers and a nonce CSP", async () => {
  const response = await request("/");
  const h = (name) => response.headers.get(name) ?? "";
  const csp = h("content-security-policy");
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";

  const problems = [
    response.status !== 200 && `status ${response.status}`,
    !h("content-type").includes("text/html") && `content-type ${h("content-type")}`,
    !h("strict-transport-security") && "no Strict-Transport-Security",
    h("x-content-type-options").toLowerCase() !== "nosniff" && "no X-Content-Type-Options: nosniff",
    !h("referrer-policy") && "no Referrer-Policy",
    h("x-frame-options").toUpperCase() !== "DENY" && "no X-Frame-Options: DENY",
    !h("permissions-policy") && "no Permissions-Policy",
    !/'nonce-[^']+'/.test(scriptSrc) && "script-src has no nonce",
    scriptSrc.includes("'unsafe-eval'") && "script-src has 'unsafe-eval'",
    response.headers.has("x-powered-by") && "X-Powered-By is present",
  ].filter(Boolean);

  return problems.length ? problems.join("; ") : null;
});

await check("3. signed out, /dashboard /bookings /admin redirect to /login?returnUrl=", async () => {
  for (const path of ["/dashboard", "/bookings", "/admin"]) {
    const response = await request(path);
    const location = response.headers.get("location") ?? "";
    const ok = response.status >= 300 && response.status < 400 && /\/login\?returnUrl=/.test(location);
    if (!ok) return `${path}: status ${response.status}, location "${location}"`;
  }
  return null;
});

await check("4. POST /api/bookings is 403 for a foreign Origin and for no Origin", async () => {
  for (const [label, headers] of [
    ["foreign Origin", { origin: "https://evil.example", "content-type": "application/json" }],
    ["no Origin", { "content-type": "application/json" }],
  ]) {
    const response = await request("/api/bookings", { method: "POST", headers, body: "{}" });
    const body = await response.json().catch(() => null);
    if (response.status !== 403) return `${label}: status ${response.status}`;
    if (typeof body?.error?.message !== "string") return `${label}: body is not { error: { message } }`;
  }
  return null;
});

await check(`5. /api/events is 200 with a data array${expectSeed ? "; /api/classes has 6 programmes" : ""}`, async () => {
  const events = await request("/api/events");
  const eventsBody = await events.json().catch(() => null);
  if (events.status !== 200 || !Array.isArray(eventsBody?.data)) return `/api/events: status ${events.status}`;

  if (expectSeed) {
    const classes = await request("/api/classes");
    const classesBody = await classes.json().catch(() => null);
    if (classes.status !== 200 || !Array.isArray(classesBody?.data)) return `/api/classes: status ${classes.status}`;
    if (classesBody.data.length !== 6) return `/api/classes returned ${classesBody.data.length} programmes, expected 6`;
  }
  return null;
});

await check("6. /reset-password/abc is 200, no-referrer, no-store", async () => {
  const response = await request("/reset-password/abc");
  const policy = response.headers.get("referrer-policy") ?? "";
  const cache = response.headers.get("cache-control") ?? "";
  return expect(
    response.status === 200 && policy === "no-referrer" && cache.includes("no-store"),
    `status ${response.status}, Referrer-Policy "${policy}", Cache-Control "${cache}"`,
  );
});

await check("7. /no-such-page is 404 with no stack trace or 'prisma' in the body", async () => {
  const response = await request("/no-such-page");
  const text = (await response.text()).toLowerCase();
  const problems = [
    response.status !== 404 && `status ${response.status}`,
    text.includes("prisma") && "body mentions prisma",
    /\n\s+at\s.+\(.+:\d+:\d+\)/.test(text) && "body looks like a stack trace",
  ].filter(Boolean);
  return problems.length ? problems.join("; ") : null;
});

if (isLocal || !base.startsWith("https://")) {
  process.stdout.write("SKIP  8. http:// redirects to https:// (local or non-https base URL)\n");
} else {
  await check("8. http:// redirects to https://", async () => {
    const response = await request(base.replace("https://", "http://") + "/");
    const location = response.headers.get("location") ?? "";
    return expect(
      response.status >= 300 && response.status < 400 && location.startsWith("https://"),
      `status ${response.status}, location "${location}"`,
    );
  });
}

process.stdout.write(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
