/**
 * The release pipeline: the rollback script against a fake Vercel API, the
 * monitor's decisions, and the shape of every workflow file. No database, no
 * network beyond localhost.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { parse } from "yaml";

import * as monitor from "../scripts/ci/monitor.mjs";
import * as vercel from "../scripts/ci/vercel-rollback.mjs";

const ROOT = path.resolve(__dirname, "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

// ---------------------------------------------------------------- a fake Vercel

interface Fake {
  url: string;
  calls: { method: string; path: string; auth: string | undefined; team: string | null }[];
  /** Which deployment the project reports as live. */
  live: string;
  /** After a promote, the project reports the new one only after this many checks. */
  lag: number;
  failPromote: number | null;
  /** The next this many promotes are answered 409, then they succeed. */
  conflicts: number;
  /** Sent as Retry-After (seconds) on a 409. */
  retryAfter: number | null;
  deployments: { uid: string; url: string; created: number }[];
  close(): Promise<void>;
}

async function fakeVercel(): Promise<Fake> {
  const state = {
    calls: [] as Fake["calls"],
    live: "dpl_new",
    pending: null as { id: string; checks: number } | null,
    lag: 0,
    failPromote: null as number | null,
    conflicts: 0,
    retryAfter: null as number | null,
    deployments: [
      { uid: "dpl_new", url: "new.vercel.app", created: 3 },
      { uid: "dpl_old", url: "old.vercel.app", created: 2 },
      { uid: "dpl_older", url: "older.vercel.app", created: 1 },
    ],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    state.calls.push({ method: req.method ?? "", path: url.pathname, auth: req.headers.authorization, team: url.searchParams.get("teamId") });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && url.pathname === "/v9/projects/prj_1") {
      if (state.pending && --state.pending.checks < 0) {
        state.live = state.pending.id;
        state.pending = null;
      }
      return send(200, { targets: { production: { id: state.live, url: `${state.live}.vercel.app`, alias: ["pfc.example"] } } });
    }
    if (req.method === "GET" && url.pathname === "/v6/deployments") {
      return send(200, { deployments: state.deployments });
    }
    const promote = /^\/v10\/projects\/prj_1\/promote\/(.+)$/.exec(url.pathname);
    if (req.method === "POST" && promote) {
      if (state.conflicts > 0 || state.failPromote === 409) {
        if (state.conflicts > 0) state.conflicts--;
        res.writeHead(409, { "content-type": "application/json", ...(state.retryAfter ? { "retry-after": String(state.retryAfter) } : {}) });
        return res.end(JSON.stringify({ error: { code: "conflict", message: "secret detail that must not be printed" } }));
      }
      if (state.failPromote) return send(state.failPromote, { error: { code: "forbidden", message: "secret detail that must not be printed" } });
      state.pending = { id: decodeURIComponent(promote[1]!), checks: state.lag };
      return send(201, {});
    }
    send(404, { error: { code: "not_found" } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    calls: state.calls,
    get live() { return state.live; },
    set live(v) { state.live = v; },
    get lag() { return state.lag; },
    set lag(v) { state.lag = v; },
    get failPromote() { return state.failPromote; },
    set failPromote(v) { state.failPromote = v; },
    get conflicts() { return state.conflicts; },
    set conflicts(v) { state.conflicts = v; },
    get retryAfter() { return state.retryAfter; },
    set retryAfter(v) { state.retryAfter = v; },
    deployments: state.deployments,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const TOKEN = "vercel-token-that-must-never-be-printed";
const env = (api: string) => ({ VERCEL_API: api, VERCEL_TOKEN: TOKEN, VERCEL_PROJECT_ID: "prj_1", VERCEL_ORG_ID: "team_1" });

async function main() {
  console.log("\nROLLBACK SCRIPT");

  const fake = await fakeVercel();
  try {
    await check("the token may only be sent to Vercel or to a local test server", () => {
      assert.equal(vercel.apiBase({}), "https://api.vercel.com");
      assert.equal(vercel.apiBase({ VERCEL_API: "http://127.0.0.1:4000/" }), "http://127.0.0.1:4000");
      for (const evil of ["https://evil.example", "http://127.0.0.1.evil.example", "https://api.vercel.com.evil.example", "http://localhost.evil.example"]) {
        assert.throws(() => vercel.apiBase({ VERCEL_API: evil }), /may only be/, evil);
      }
    });

    await check("it needs the token, the project and the team", () => {
      for (const missing of ["VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID"]) {
        const e = env(fake.url) as Record<string, string>;
        delete e[missing];
        assert.throws(() => vercel.client(e), new RegExp(missing));
      }
    });

    await check("it reads the live production deployment and the one before it, with the bearer token and the team", async () => {
      const api = vercel.client(env(fake.url));
      const live = await api.current();
      assert.deepEqual(live, { id: "dpl_new", url: "dpl_new.vercel.app", domains: ["pfc.example"] });

      const ready = await api.readyProduction(2);
      assert.deepEqual(ready.map((d: { id: string }) => d.id), ["dpl_new", "dpl_old", "dpl_older"]);
      assert.ok(fake.calls.every((c) => c.auth === `Bearer ${TOKEN}` && c.team === "team_1"));
    });

    await check("promote posts to the promote endpoint and an error shows the status but not the body or the token", async () => {
      const api = vercel.client(env(fake.url));
      await api.promote("dpl_old");
      assert.ok(fake.calls.some((c) => c.method === "POST" && c.path === "/v10/projects/prj_1/promote/dpl_old"));

      fake.failPromote = 403;
      await assert.rejects(api.promote("dpl_old"), (e: Error) => {
        assert.match(e.message, /403/);
        assert.match(e.message, /forbidden/);
        assert.ok(!e.message.includes("secret detail"));
        assert.ok(!e.message.includes(TOKEN));
        return true;
      });
      fake.failPromote = null;
    });

    const posts = () => fake.calls.filter((c) => c.method === "POST").length;

    await check("a promote answered 409 is retried after a wait, using Retry-After when Vercel sends it, and then succeeds", async () => {
      const waits: number[] = [];
      const api = vercel.client(env(fake.url), { sleep: async (ms: number) => { waits.push(ms); } });
      const before = posts();
      fake.conflicts = 2;
      await api.promote("dpl_old");
      assert.equal(posts() - before, 3, "two refusals and one success");
      assert.deepEqual(waits, [5000, 5000]);

      waits.length = 0;
      fake.conflicts = 1;
      fake.retryAfter = 2;
      await api.promote("dpl_old");
      assert.deepEqual(waits, [2000], "Retry-After wins over the default wait");
      fake.retryAfter = null;
    });

    await check("a permanent 409 fails after six retries without printing a body or the token", async () => {
      const waits: number[] = [];
      const api = vercel.client(env(fake.url), { sleep: async (ms: number) => { waits.push(ms); } });
      const before = posts();
      fake.failPromote = 409;
      await assert.rejects(api.promote("dpl_old"), (e: Error) => {
        assert.match(e.message, /409/);
        assert.match(e.message, /conflict/);
        assert.ok(!e.message.includes("secret detail"));
        assert.ok(!e.message.includes(TOKEN));
        return true;
      });
      assert.equal(posts() - before, 7, "the first try and six retries");
      assert.equal(waits.length, 6);
      fake.failPromote = null;
    });

    await check("any other refusal, such as 403, fails at once without a retry", async () => {
      const waits: number[] = [];
      const api = vercel.client(env(fake.url), { sleep: async (ms: number) => { waits.push(ms); } });
      const before = posts();
      fake.failPromote = 403;
      await assert.rejects(api.promote("dpl_old"), /403/);
      assert.equal(posts() - before, 1);
      assert.equal(waits.length, 0);
      fake.failPromote = null;
    });

    await check("rollback waits for the project to report the old deployment, then verifies readiness", async () => {
      fake.live = "dpl_new";
      fake.lag = 2; // the project keeps reporting the new one for two more checks
      const api = vercel.client(env(fake.url));
      const seen: string[] = [];

      const result = await vercel.rollback(api, "dpl_old", {
        pollMs: 1,
        ready: async (target: string) => {
          seen.push(target);
          return { ok: true, attempts: 1 };
        },
      });

      assert.deepEqual(result, { ok: true, id: "dpl_old", url: "https://pfc.example" });
      assert.deepEqual(seen, ["https://pfc.example"], "readiness is checked on the production domain, not the deployment's own address");
      assert.equal(fake.live, "dpl_old");
    });

    await check("rollback reports failure when the project never switches, or when readiness fails", async () => {
      const api = vercel.client(env(fake.url));

      fake.live = "dpl_new";
      fake.lag = 1000;
      const stuck = await vercel.rollback(api, "dpl_old", { pollMs: 1, polls: 3, ready: async () => ({ ok: true }) });
      assert.equal(stuck.ok, false);
      assert.equal(stuck.step, "promote");

      fake.lag = 0;
      fake.live = "dpl_new";
      const unhealthy = await vercel.rollback(api, "dpl_old", { pollMs: 1, ready: async () => ({ ok: false, reason: "status 503" }) });
      assert.equal(unhealthy.ok, false);
      assert.equal(unhealthy.step, "ready");
      assert.match(unhealthy.detail, /503/);
    });

    await check("waitReady polls until the site answers 200 {status: ok}, and gives up with a reason", async () => {
      let hits = 0;
      const site = http.createServer((req, res) => {
        hits++;
        if (hits < 3) { res.writeHead(503); res.end(JSON.stringify({ status: "unavailable" })); return; }
        assert.equal(req.headers["x-vercel-protection-bypass"], "bypass-value");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });
      await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

      const ok = await vercel.waitReady(base, { tries: 5, delayMs: 1, env: { VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-value" } });
      assert.deepEqual(ok, { ok: true, attempts: 3 });

      hits = -100;
      const down = await vercel.waitReady(base, { tries: 2, delayMs: 1, env: {} });
      assert.equal(down.ok, false);
      assert.match(down.reason!, /503/);
      await new Promise((resolve) => site.close(resolve));
    });
  } finally {
    await fake.close();
  }

  console.log("\nMONITOR");

  const ok = { ok: true, ms: 200 };
  const healthy = {
    status: "ok",
    database: { latencyMs: 30, sizeBytes: 50 * 1048576, migrations: { pending: [] as string[], newerThanThisRelease: [] as string[] } },
    outbox: { pending: 0, dead: 0, deadLast24h: 0, sentLast24h: 3 },
    configured: { email: true },
    maintenance: { lastRunAt: new Date("2027-03-10T03:00:00Z").toISOString() },
  };
  const now = new Date("2027-03-10T12:00:00Z");

  await check("a healthy site raises nothing, and only readiness is judged without a token", () => {
    assert.deepEqual(monitor.evaluate({ ready: ok, detail: healthy }, now), []);
    assert.deepEqual(monitor.evaluate({ ready: ok, detail: undefined }, now), []);
  });

  await check("each threshold raises its own plain-sentence problem", () => {
    const worse = (patch: (d: typeof healthy) => void) => {
      const d = structuredClone(healthy);
      patch(d);
      return monitor.evaluate({ ready: ok, detail: d }, now) as string[];
    };

    assert.match(monitor.evaluate({ ready: { ok: false, ms: 5, reason: "status 503" }, detail: undefined }, now)[0]!, /Readiness check failed/);
    assert.match(monitor.evaluate({ ready: { ok: true, ms: 4000 }, detail: undefined }, now)[0]!, /took 4000 ms/);
    assert.match(monitor.evaluate({ ready: ok, detail: null }, now)[0]!, /could not be read/);
    assert.match(worse((d) => { d.database.sizeBytes = 450 * 1048576; })[0]!, /450 MB/);
    assert.match(worse((d) => { d.database.migrations.pending = ["2027_x"]; })[0]!, /2027_x/);
    assert.match(worse((d) => { d.database.latencyMs = 2000; })[0]!, /latency is 2000 ms/);
    assert.deepEqual(worse((d) => { d.outbox.dead = 40; d.outbox.deadLast24h = 3; }), [], "three dead letters a day are normal, however many old ones there are");
    assert.match(worse((d) => { d.outbox.deadLast24h = 4; })[0]!, /4 emails failed for good in the last 24 hours \(limit 3\)/);
    assert.match(worse((d) => { d.outbox.pending = 30; })[0]!, /30 emails are waiting/);
    assert.match(worse((d) => { d.outbox.sentLast24h = 96; })[0]!, /daily limit/);
    assert.match(worse((d) => { d.configured.email = false; })[0]!, /not configured/);
    assert.match(worse((d) => { d.maintenance.lastRunAt = "2027-03-08T03:00:00Z"; })[0]!, /maintenance job has not run/);
    assert.match(worse((d) => { (d as { maintenance: { lastRunAt: string | null } }).maintenance.lastRunAt = null; })[0]!, /^The maintenance job has never run.$/);
  });

  await check("one incident issue: opened, updated only when the problems change, closed on recovery", () => {
    const first = monitor.decide(["Readiness check failed (status 503)."], null, now);
    assert.equal(first.action, "open");
    assert.match(first.body, /- Readiness check failed/);

    assert.equal(monitor.decide(["Readiness check failed (status 503)."], first.body, new Date(now.getTime() + 900_000)).action, "none", "the same problem does not spam the issue");
    assert.equal(monitor.decide(["Readiness check failed (status 503).", "Database is 450 MB (limit 400 MB)."], first.body, now).action, "update");
    assert.equal(monitor.decide([], first.body, now).action, "close");
    assert.equal(monitor.decide([], null, now).action, "none");
  });

  console.log("\nWORKFLOWS");

  const load = (file: string) => parse(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml")).sort();

  await check("every workflow parses, names its triggers and sets least-privilege permissions", () => {
    assert.deepEqual(files, ["ci.yml", "codeql.yml", "dependency-review.yml", "deploy.yml", "monitor.yml", "outbox-drain.yml", "rollback-drill.yml"]);
    for (const file of files) {
      const wf = load(file);
      assert.ok(wf.name, file);
      assert.ok(wf.on, `${file} has triggers`);
      assert.ok(wf.permissions, `${file} sets permissions`);
      assert.ok(wf.jobs && Object.keys(wf.jobs).length > 0);
    }
  });

  await check("no workflow puts a secret in a command line: secrets reach steps through env only", () => {
    for (const file of files) {
      const text = readFileSync(path.join(WORKFLOWS, file), "utf8");
      const wf = load(file);
      for (const [job, def] of Object.entries<any>(wf.jobs)) { // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const step of def.steps ?? []) {
          if (typeof step.run === "string") {
            assert.ok(!/\$\{\{\s*secrets\./.test(step.run), `${file} ${job}: "${step.name}" uses a secret in its script`);
          }
        }
      }
      assert.ok(!/echo[^\n]*\$\{\{\s*secrets\./.test(text), `${file} echoes a secret`);
    }
  });

  await check("deploy.yml records the live deployment first, rolls back on a failed smoke test, verifies, summarises and then fails", () => {
    const deploy = load("deploy.yml");
    const steps: any[] = deploy.jobs.production.steps; // eslint-disable-line @typescript-eslint/no-explicit-any
    const index = (name: RegExp) => steps.findIndex((s) => name.test(s.name ?? ""));

    const record = index(/Record the production deployment/);
    const migrate = index(/Apply database migrations/);
    const deployStep = index(/^Deploy$/);
    const smoke = index(/Smoke test/);
    const rollback = index(/Roll back/);
    const summary = index(/^Summary$/);
    const fail = index(/Fail the job/);

    assert.ok(record >= 0 && record < migrate, "the live id is read before anything changes");
    assert.ok(migrate < deployStep && deployStep < smoke && smoke < rollback && rollback < summary && summary < fail);

    assert.equal(steps[smoke].id, "smoke");
    assert.equal(steps[smoke]["continue-on-error"], true, "so the rollback step can run");
    assert.match(steps[rollback].if, /steps\.smoke\.outcome == 'failure'/);
    assert.match(steps[rollback].run, /vercel-rollback\.mjs rollback/);
    assert.equal(steps[summary].if, "always()");
    assert.match(steps[fail].if, /steps\.smoke\.outcome == 'failure'/);

    const text = readFileSync(path.join(WORKFLOWS, "deploy.yml"), "utf8");
    assert.match(text, /MIGRATIONS ARE FORWARD-ONLY/);
    assert.match(text, /User not found/, "the reason the CLI is not used is written down");
    assert.ok(!/vercel (rollback|promote)/.test(steps.map((s) => s.run ?? "").join("\n")), "no CLI rollback");
  });

  await check("the rollback drill is manual, needs the production approval, and cannot run twice at once", () => {
    const drill = load("rollback-drill.yml");
    assert.deepEqual(Object.keys(drill.on), ["workflow_dispatch"]);
    assert.equal(drill.jobs.drill.environment, "production");
    assert.equal(drill.concurrency["cancel-in-progress"], false);
    assert.match(JSON.stringify(drill.jobs.drill.steps), /vercel-rollback\.mjs drill/);
  });

  await check("the drill summary always runs, says when there was no output, and on failure names the deployment to restore and the command", () => {
    const steps = load("rollback-drill.yml").jobs.drill.steps;
    const summary = steps.find((s: { name?: string }) => s.name === "Summary");
    assert.ok(summary, "a Summary step");
    assert.equal(summary.if, "always()");
    assert.match(summary.run, /The drill produced no output\./);
    assert.match(summary.run, /live now: /, "reads the id recorded before the drill");
    assert.match(summary.run, /vercel promote \$LIVE_BEFORE/);
    assert.ok(!/secrets\./.test(summary.run));
  });

  await check("the monitor runs every 15 minutes, opens one incident issue and closes it on recovery", () => {
    const wf = load("monitor.yml");
    assert.deepEqual(wf.on.schedule, [{ cron: "*/15 * * * *" }]);
    assert.equal(wf.permissions.issues, "write");
    const text = readFileSync(path.join(WORKFLOWS, "monitor.yml"), "utf8");
    for (const needle of ["--label incident", "gh issue create", "gh issue close", "gh issue edit", "gh label create incident"]) {
      assert.ok(text.includes(needle), needle);
    }
  });

  await check("CI runs the tests on Node 20 and 24 and also checks integrity, migration drift, coverage, OpenAPI and audit", () => {
    const ci = load("ci.yml");
    assert.deepEqual(ci.jobs.test.strategy.matrix.node, [20, 24]);
    assert.equal(ci.jobs.test.strategy["fail-fast"], false);
    const text = readFileSync(path.join(WORKFLOWS, "ci.yml"), "utf8");
    for (const needle of ["npm run db:verify", "prisma migrate diff", "--exit-code", "npm run coverage", "npm run openapi:lint", "npm audit --omit=dev --audit-level=high", "git diff --exit-code src/lib/openapi.json"]) {
      assert.ok(text.includes(needle), needle);
    }
    assert.ok(ci.jobs.openapi && ci.jobs.audit && ci.jobs.lint && ci.jobs.typecheck && ci.jobs.build);
  });

  await check("the outbox drain runs hourly with PRODUCTION_URL and CRON_SECRET, keeps the secret out of the command line, and says what GitHub does to schedules", () => {
    const wf = load("outbox-drain.yml");
    assert.match(wf.on.schedule[0].cron, /^\d+ \* \* \* \*$/, "hourly");
    assert.ok(wf.on.workflow_dispatch !== undefined);
    assert.deepEqual(wf.permissions, {});

    const text = readFileSync(path.join(WORKFLOWS, "outbox-drain.yml"), "utf8");
    assert.match(text, /vars\.PRODUCTION_URL/);
    assert.match(text, /secrets\.CRON_SECRET/);
    assert.match(text, /\/api\/cron\/outbox/);
    assert.match(text, /-H @headers\.txt/, "the bearer token goes through a file");
    assert.ok(!/curl[^\n]*CRON_SECRET/.test(text), "not on the curl command line");
    assert.match(text, /60 days/, "the 60-day rule is written down");
    assert.match(text, /may delay/i);
  });

  await check("CI scans the whole git history for secrets and runs Semgrep with metrics off; pull requests get a dependency review", () => {
    const ci = load("ci.yml");

    const gitleaks = ci.jobs.gitleaks.steps;
    assert.equal(gitleaks[0].with["fetch-depth"], 0, "every commit, not only the tip");
    const gitleaksRun = String(gitleaks[1].run);
    assert.match(gitleaksRun, /zricethezav\/gitleaks:v\d+\.\d+\.\d+/, "a pinned tag, not latest");
    assert.match(gitleaksRun, /\bgit \/repo\b/, "git mode, not --no-git");
    assert.ok(!gitleaksRun.includes("--no-git "));
    assert.match(gitleaksRun, /--redact/);

    const semgrep = String(ci.jobs.semgrep.steps[1].run);
    assert.match(ci.jobs.semgrep.container.image, /^semgrep\/semgrep:\d+\.\d+\.\d+$/);
    assert.match(semgrep, /--metrics=off/);
    assert.match(semgrep, /--error/, "a finding fails the job");
    for (const pack of ["p/typescript", "p/nextjs", "p/owasp-top-ten", "p/secrets"]) assert.ok(semgrep.includes(pack), pack);

    const review = load("dependency-review.yml");
    assert.deepEqual(Object.keys(review.on), ["pull_request"]);
    assert.match(JSON.stringify(review.jobs.review.steps), /actions\/dependency-review-action@[0-9a-f]{40}/);

    // The ignore file for reviewed findings gives a reason for every entry.
    const ignore = readFileSync(path.join(ROOT, ".gitleaksignore"), "utf8").split(/\r?\n/);
    const entries = ignore.filter((l) => l.trim() && !l.startsWith("#"));
    assert.ok(entries.length >= 1 && entries.every((l) => /^[0-9a-f]{40}:[^:]+:[\w-]+:\d+$/.test(l)));
    assert.ok(ignore.some((l) => l.startsWith("#")), "and says why");
  });

  await check("every action in every workflow is pinned to a full commit SHA with its tag in a comment, and Dependabot keeps them current", () => {
    const unpinned: string[] = [];
    let count = 0;
    for (const file of files) {
      for (const [index, line] of readFileSync(path.join(WORKFLOWS, file), "utf8").split(/\r?\n/).entries()) {
        const match = /\buses:\s*(\S+)/.exec(line);
        if (!match || match[1]!.startsWith("./")) continue;
        count++;
        if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(match[1]!) || !/#\s*v?\d/.test(line)) {
          unpinned.push(`${file}:${index + 1} ${line.trim()}`);
        }
      }
    }
    assert.ok(count >= 10, "the scan found the actions");
    assert.deepEqual(unpinned, [], "pin with the tag in a comment: uses: owner/repo@<40 hex> # v4");

    const dependabot = parse(readFileSync(path.join(ROOT, ".github", "dependabot.yml"), "utf8")) as { updates: { "package-ecosystem": string; directory: string }[] };
    assert.ok(dependabot.updates.some((u) => u["package-ecosystem"] === "github-actions" && u.directory === "/"));
  });

  await check("CodeQL scans JavaScript and TypeScript on pull requests and weekly", () => {
    const wf = load("codeql.yml");
    assert.ok(wf.on.pull_request && wf.on.push);
    assert.equal(wf.on.schedule.length, 1);
    assert.equal(wf.jobs.analyze.permissions["security-events"], "write");
    assert.match(JSON.stringify(wf.jobs.analyze.steps), /javascript-typescript/);
  });

  console.log(`\n${passed} checks passed\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
