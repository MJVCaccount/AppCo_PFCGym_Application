/**
 * Contract test: docs/openapi.yaml against the code and against real
 * responses.
 *
 *  1. Every route file and method has an entry in the spec, and every entry
 *     has a route (both directions).
 *  2. The JSON copy the app serves is the YAML, byte for byte after parsing.
 *  3. Each operation is described completely enough to be useful.
 *  4. Real responses from the real handlers, for success and for the common
 *     failures, are documented (the status is listed) and match their schema.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { resetDatabase, testDb } from "./helpers/db";

import { NOT_ALLOWED } from "../src/lib/apiHandler";
import served from "../src/lib/openapi.json";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { createBooking } from "../src/lib/services/bookingService";
import { createSession, destroySession } from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";
import { padded, pngHead } from "./support/files";

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "src", "app", "api");
const ORIGIN = "https://pfc.test.invalid";
process.env.APP_URL = ORIGIN;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

// ---------------------------------------------------------------- spec

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const spec = parse(readFileSync(path.join(ROOT, "docs", "openapi.yaml"), "utf8")) as Json;

function resolveRef(ref: string): Json {
  assert.ok(ref.startsWith("#/"), `only local refs: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce<Json>((node, key) => {
      assert.ok(node && key in node, `dangling $ref ${ref}`);
      return node[key];
    }, spec);
}

/** A response object with any $ref followed. */
function deref(node: Json): Json {
  return node.$ref ? deref(resolveRef(node.$ref)) : node;
}

// A small JSON Schema validator: enough for this spec (3.1 style), no dependency.
function validate(value: unknown, schema: Json, where = "$"): string[] {
  if (schema.$ref) return validate(value, resolveRef(schema.$ref), where);

  const errors: string[] = [];
  const fail = (message: string) => errors.push(`${where}: ${message}`);

  if (schema.oneOf) {
    const matches = (schema.oneOf as Json[]).filter((s) => validate(value, s, where).length === 0);
    if (matches.length !== 1) fail(`matches ${matches.length} of oneOf`);
    return errors;
  }

  const types: string[] = schema.type ? [].concat(schema.type) : [];
  const typeOf = (v: unknown): string =>
    v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (types.length > 0) {
    const actual = typeOf(value);
    const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) {
      fail(`expected ${types.join("|")}, got ${actual}`);
      return errors;
    }
  }

  if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`"${value}" does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) fail("too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail("too long");
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) fail(`"${value}" is not a date-time`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${where}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) fail(`missing "${key}"`);
    }
    const props = (schema.properties ?? {}) as Json;
    for (const [key, item] of Object.entries(record)) {
      if (key in props) errors.push(...validate(item, props[key], `${where}.${key}`));
      else if (schema.additionalProperties === false) fail(`unexpected "${key}"`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- routes

/** Every real route file: its spec path and the methods it implements. */
function discoverRoutes(): { specPath: string; file: string; methods: Method[] }[] {
  const found: { specPath: string; file: string; methods: Method[] }[] = [];

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const rel = path.relative(API_DIR, path.dirname(full)).split(path.sep);
        if (rel[0] === "[...path]") continue; // the catch-all is not an API route
        const specPath = "/api" + (rel[0] === "" ? "" : "/" + rel.join("/")).replace(/\[(\w+)\]/g, "{$1}");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(full) as Record<string, unknown>;
        const methods = METHODS.filter((m) => {
          const handler = mod[m.toUpperCase()] as (Record<symbol, boolean> & (() => void)) | undefined;
          return typeof handler === "function" && !handler[NOT_ALLOWED];
        });
        found.push({ specPath, file: full, methods });
      }
    }
  };
  walk(API_DIR);
  return found;
}

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>;

const routes = discoverRoutes();

function handlerFor(specPath: string, method: string): Handler {
  const route = routes.find((r) => r.specPath === specPath);
  assert.ok(route, `${specPath} has a route file`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require(route.file) as Record<string, Handler>)[method.toUpperCase()]!;
}

interface Observed {
  status: number;
  body: unknown;
  headers: Headers;
}

/** Calls a real handler and checks the answer against the spec. */
async function call(
  method: Method,
  specPath: string,
  options: { as?: SessionUser | null; params?: Record<string, string | number>; query?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): Promise<Observed> {
  if (options.as) await createSession(options.as);
  else await destroySession();

  let url = specPath;
  for (const [key, value] of Object.entries(options.params ?? {})) url = url.replace(`{${key}}`, String(value));
  const init: RequestInit = { method: method.toUpperCase(), headers: { origin: ORIGIN, ...options.headers } };
  if (options.form) init.body = options.form;
  else if (options.body !== undefined) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    (init.headers as Record<string, string>)["content-type"] ??= "application/json";
  }

  const response = await handlerFor(specPath, method)(
    new Request(`http://localhost${url}${options.query ?? ""}`, init),
    { params: Promise.resolve(Object.fromEntries(Object.entries(options.params ?? {}).map(([k, v]) => [k, String(v)]))) },
  );

  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await response.json() : await response.arrayBuffer();
  await destroySession();
  return { status: response.status, body, headers: response.headers };
}

/** The status is documented for this operation and the body fits its schema. */
function conforms(observed: Observed, method: Method, specPath: string, label = ""): void {
  const operation = spec.paths[specPath][method] as Json;
  const documented = operation.responses[String(observed.status)];
  assert.ok(documented, `${label}${method.toUpperCase()} ${specPath} answered ${observed.status}, which the spec does not list`);

  const response = deref(documented);
  const media = Object.entries((response.content ?? {}) as Json).find(([type]) =>
    (observed.headers.get("content-type") ?? "").startsWith(type),
  );
  assert.ok(media, `${label}${method.toUpperCase()} ${specPath} ${observed.status}: content type ${observed.headers.get("content-type")} is not described`);

  if (media[0] === "application/json") {
    const errors = validate(observed.body, media[1].schema);
    assert.deepEqual(errors, [], `${label}${method.toUpperCase()} ${specPath} ${observed.status} body does not match its schema`);
  }
  for (const header of Object.keys((response.headers ?? {}) as Json)) {
    assert.ok(observed.headers.get(header), `${label}${observed.status} should send ${header}`);
  }
}

// ---------------------------------------------------------------- fixtures

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

const PNG = padded(pngHead(), 300);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 0x20)]);
const form = (fields: Record<string, string>, file: { bytes: Buffer; name: string; type: string }) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return data;
};

async function main() {
  await resetDatabase();
  process.env.PRIVATE_BLOB_STORE_ID = "private-store-id";
  process.env.PUBLIC_BLOB_STORE_ID = "public-store-id";

  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");
  const coach = await sessionFor("sofia@pfc.co.za");
  const admin = await sessionFor("admin@pfc.co.za");

  console.log("\nOPENAPI: SPEC AND CODE AGREE");

  await check("the spec is OpenAPI 3.1 and every $ref resolves", () => {
    assert.match(spec.openapi, /^3\.1\./);
    const refs: string[] = [];
    const scan = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(scan);
      else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "$ref") refs.push(value as string);
          else scan(value);
        }
      }
    };
    scan(spec);
    assert.ok(refs.length > 50);
    refs.forEach(resolveRef);
  });

  await check("no schema or tag carries a stray key (a comma inside an unquoted flow-style value splits it into extra keys)", () => {
    const keywords = new Set(["type", "properties", "required", "items", "enum", "const", "format", "pattern", "minimum", "maximum", "minLength", "maxLength", "minProperties", "description", "example", "$ref", "additionalProperties", "oneOf", "nullable", "default"]);
    const bad: string[] = [];
    const walk = (node: unknown, where: string, isSchema: boolean) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`, isSchema));
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Json)) {
        if (isSchema && !keywords.has(key) && key !== "properties") bad.push(`${where}.${key}`);
        const childIsSchema = isSchema ? key === "items" || key === "additionalProperties" || key === "oneOf" : false;
        if (key === "properties" && isSchema) {
          for (const [name, sub] of Object.entries(value as Json)) walk(sub, `${where}.properties.${name}`, true);
        } else if (childIsSchema) walk(value, `${where}.${key}`, true);
      }
    };
    for (const [name, schema] of Object.entries(spec.components.schemas as Json)) walk(schema, name, true);
    assert.deepEqual(bad, []);

    for (const tag of spec.tags as Json[]) {
      assert.deepEqual(Object.keys(tag).sort(), ["description", "name"], JSON.stringify(tag).slice(0, 80));
    }
  });

  await check("every route file and method is in the spec, and every spec entry has a route", () => {
    const fromCode = routes.flatMap((r) => r.methods.map((m) => `${m.toUpperCase()} ${r.specPath}`)).sort();
    const fromSpec = Object.entries(spec.paths as Json)
      .flatMap(([p, item]) => METHODS.filter((m) => m in (item as Json)).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    assert.deepEqual(fromSpec, fromCode);
    assert.ok(fromCode.length >= 22, "the whole API was found");
  });

  await check("the JSON copy served at /api/openapi.json is the YAML", () => {
    assert.deepEqual(served, spec, "run `npm run openapi:build`");
  });

  await check("every operation has an id, a summary, a success response, 405 and 500, and its auth and write rules", () => {
    const ids = new Set<string>();
    for (const [p, item] of Object.entries(spec.paths as Json)) {
      for (const method of METHODS.filter((m) => m in (item as Json))) {
        const op = (item as Json)[method] as Json;
        const name = `${method.toUpperCase()} ${p}`;
        assert.ok(op.operationId && !ids.has(op.operationId), `${name} has a unique operationId`);
        ids.add(op.operationId);
        assert.ok(op.summary, `${name} has a summary`);

        const statuses = Object.keys(op.responses);
        assert.ok(statuses.some((s) => s.startsWith("2")), `${name} has a success response`);
        assert.ok(statuses.includes("405"), `${name} lists 405`);
        if (p !== "/api/health" && p !== "/api/health/ready" && p !== "/api/openapi.json") {
          // health routes never throw; everything else can answer its fixed 500
          assert.ok(statuses.includes("500") || p.startsWith("/api/health"), `${name} lists 500`);
        }
        if (op.security?.length) assert.ok(statuses.includes("401"), `${name} is secured so it lists 401`);
        if (method !== "get") {
          assert.ok(op.requestBody || method === "delete" || /\/(cancel|sign-out-everywhere|erase)$/.test(p), `${name} describes its body`);
          assert.ok(statuses.includes("403"), `${name} is a write so it lists 403`);
        }
        if (op.requestBody?.content?.["application/json"]) {
          for (const s of ["413", "415"]) assert.ok(statuses.includes(s), `${name} takes JSON so it lists ${s}`);
        }
        for (const param of (item as Json).parameters ?? op.parameters ?? []) deref(param);
        for (const segment of p.match(/\{(\w+)\}/g) ?? []) {
          const named = (op.parameters as Json[]).map((x) => deref(x).name);
          assert.ok(named.includes(segment.slice(1, -1)), `${name} declares ${segment}`);
        }
        for (const s of statuses) {
          const r = deref(op.responses[s]);
          assert.ok(r.description, `${name} ${s} has a description`);
          if (s !== "200" && s !== "201" && s !== "503" && r.content?.["application/json"]) {
            // every error carries an example, so the docs show what comes back
            if (Number(s) >= 400) assert.ok(r.content["application/json"].example || r.content["application/json"].schema, `${name} ${s} is shown`);
          }
        }
      }
    }
  });

  console.log("\nOPENAPI: REAL RESPONSES MATCH");

  await check("public reads: health, readiness, the spec, classes, timetable, events", async () => {
    for (const p of ["/api/health", "/api/health/ready", "/api/openapi.json", "/api/classes", "/api/timetable", "/api/events"]) {
      const r = await call("get", p);
      assert.equal(r.status, 200, p);
      conforms(r, "get", p);
    }
    const one = await call("get", "/api/timetable", { query: "?day=mon" });
    conforms(one, "get", "/api/timetable");
    assert.ok((one.body as { data: { day: string }[] }).data.every((s) => s.day === "mon"));

    const bad = await call("get", "/api/timetable", { query: "?day=funday" });
    assert.equal(bad.status, 400);
    conforms(bad, "get", "/api/timetable");
  });

  const slot = await testDb.gymClass.findFirstOrThrow({ where: { isActive: true, day: "sat" } });
  let bookingId = 0;

  await check("bookings: list, book, cancel, and their failures", async () => {
    let r = await call("get", "/api/bookings", { as: member });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/bookings");

    r = await call("post", "/api/bookings", { as: member, body: { slotId: slot.id } });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/bookings");

    r = await call("get", "/api/bookings", { as: member });
    const upcoming = (r.body as { data: { upcoming: { id: number }[] } }).data.upcoming;
    assert.ok(upcoming.length > 0);
    conforms(r, "get", "/api/bookings");
    bookingId = upcoming[0]!.id;

    for (const [options, status] of [
      [{ as: member, body: { slotId: slot.id } }, 409],
      [{ as: member, body: { slotId: "x" } }, 400],
      [{ as: member, body: { slotId: 999999 } }, 404],
      [{ as: coach, body: { slotId: slot.id } }, 403],
      [{ as: null, body: { slotId: slot.id } }, 401],
      [{ as: member, body: "{", headers: { "content-type": "application/json" } }, 400],
      [{ as: member, body: "{}", headers: { "content-type": "text/plain" } }, 415],
      [{ as: member, body: { pad: "x".repeat(100_001) } }, 413],
      [{ as: member, body: {}, headers: { origin: "https://evil.example" } }, 403],
    ] as const) {
      const failed = await call("post", "/api/bookings", options as never);
      assert.equal(failed.status, status, JSON.stringify(options).slice(0, 80));
      conforms(failed, "post", "/api/bookings");
    }
    for (const as of [null, coach]) {
      const denied = await call("get", "/api/bookings", { as });
      conforms(denied, "get", "/api/bookings");
    }

    const other = await call("post", "/api/bookings/{id}/cancel", { as: fighter, params: { id: bookingId } });
    assert.equal(other.status, 404, "someone else's booking is 404");
    conforms(other, "post", "/api/bookings/{id}/cancel");
    r = await call("post", "/api/bookings/{id}/cancel", { as: member, params: { id: bookingId } });
    assert.equal(r.status, 200);
    conforms(r, "post", "/api/bookings/{id}/cancel");
    r = await call("post", "/api/bookings/{id}/cancel", { as: member, params: { id: bookingId } });
    assert.equal(r.status, 409);
    conforms(r, "post", "/api/bookings/{id}/cancel");
    r = await call("post", "/api/bookings/{id}/cancel", { as: member, params: { id: "1e2" } });
    assert.equal(r.status, 400);
    conforms(r, "post", "/api/bookings/{id}/cancel");
  });

  let eventId = 0;
  let offerId = 0;

  await check("admin: create an event, edit it, offer a bout, fighter answers, result, cancel", async () => {
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString();
    let r = await call("post", "/api/admin/events", {
      as: admin,
      body: { name: "Contract Night", venue: "Test Hall", description: "An event for the contract test.", eventDate: future },
    });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/admin/events");
    eventId = (r.body as { data: { id: number } }).data.id;

    for (const [as, status] of [[member, 403], [null, 401]] as const) {
      r = await call("post", "/api/admin/events", { as, body: {} });
      assert.equal(r.status, status);
      conforms(r, "post", "/api/admin/events");
    }
    r = await call("post", "/api/admin/events", { as: admin, body: { name: "x" } });
    assert.equal(r.status, 400);
    conforms(r, "post", "/api/admin/events");

    r = await call("patch", "/api/admin/events/{id}", { as: admin, params: { id: eventId }, body: { venue: "Other Hall" } });
    assert.equal(r.status, 200);
    conforms(r, "patch", "/api/admin/events/{id}");
    r = await call("patch", "/api/admin/events/{id}", { as: admin, params: { id: 999999 }, body: { venue: "A real venue" } });
    assert.equal(r.status, 404);
    conforms(r, "patch", "/api/admin/events/{id}");
    r = await call("patch", "/api/admin/events/{id}", { as: admin, params: { id: eventId }, body: { status: "Completed" } });
    assert.equal(r.status, 409, "an event cannot be completed before it happens");
    conforms(r, "patch", "/api/admin/events/{id}");

    r = await call("post", "/api/admin/events/{id}/offers", { as: admin, params: { id: eventId }, body: { fighterId: fighter.id, opponentName: "J. Smith" } });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/admin/events/{id}/offers");
    offerId = (r.body as { data: { id: number } }).data.id;
    r = await call("post", "/api/admin/events/{id}/offers", { as: admin, params: { id: eventId }, body: { fighterId: fighter.id } });
    assert.equal(r.status, 409);
    conforms(r, "post", "/api/admin/events/{id}/offers");

    r = await call("get", "/api/fighter/offers", { as: fighter });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/fighter/offers");
    for (const as of [member, null]) conforms(await call("get", "/api/fighter/offers", { as }), "get", "/api/fighter/offers");

    r = await call("post", "/api/fighter/offers/{id}/respond", { as: fighter, params: { id: offerId }, body: { response: "Accepted" } });
    assert.equal(r.status, 200);
    conforms(r, "post", "/api/fighter/offers/{id}/respond");
    r = await call("post", "/api/fighter/offers/{id}/respond", { as: fighter, params: { id: offerId }, body: { response: "Maybe" } });
    assert.equal(r.status, 400);
    conforms(r, "post", "/api/fighter/offers/{id}/respond");
    r = await call("post", "/api/fighter/offers/{id}/respond", { as: member, params: { id: offerId }, body: { response: "Accepted" } });
    assert.equal(r.status, 403);
    conforms(r, "post", "/api/fighter/offers/{id}/respond");

    r = await call("patch", "/api/admin/participations/{id}/result", { as: admin, params: { id: offerId }, body: { result: "Win" } });
    assert.equal(r.status, 409, "the event has not happened yet");
    conforms(r, "patch", "/api/admin/participations/{id}/result");
    await testDb.competitionEvent.update({ where: { id: eventId }, data: { eventDate: new Date(Date.now() - 86_400_000) } });
    r = await call("patch", "/api/admin/participations/{id}/result", { as: admin, params: { id: offerId }, body: { result: "Win", notes: "Unanimous" } });
    assert.equal(r.status, 200);
    conforms(r, "patch", "/api/admin/participations/{id}/result");
    r = await call("patch", "/api/admin/participations/{id}/result", { as: admin, params: { id: offerId }, body: {} });
    assert.equal(r.status, 400);
    conforms(r, "patch", "/api/admin/participations/{id}/result");

    r = await call("patch", "/api/admin/events/{id}", { as: admin, params: { id: eventId }, body: { status: "Completed" } });
    assert.equal(r.status, 200);
    conforms(r, "patch", "/api/admin/events/{id}");
  });

  await check("admin: promote a member and demote them again", async () => {
    const target = await sessionFor("filler03@demo.pfc.invalid");
    let r = await call("post", "/api/admin/fighters", { as: admin, body: { memberId: target.id, weightClass: "Lightweight" } });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/admin/fighters");
    r = await call("post", "/api/admin/fighters", { as: admin, body: { memberId: target.id, weightClass: "Lightweight" } });
    assert.equal(r.status, 409);
    conforms(r, "post", "/api/admin/fighters");
    r = await call("post", "/api/admin/fighters", { as: admin, body: { memberId: 999999, weightClass: "Lightweight" } });
    assert.equal(r.status, 404);
    conforms(r, "post", "/api/admin/fighters");

    r = await call("delete", "/api/admin/fighters/{id}", { as: admin, params: { id: target.id } });
    assert.equal(r.status, 200);
    conforms(r, "delete", "/api/admin/fighters/{id}");
    r = await call("delete", "/api/admin/fighters/{id}", { as: admin, params: { id: target.id } });
    assert.equal(r.status, 404);
    conforms(r, "delete", "/api/admin/fighters/{id}");
    r = await call("delete", "/api/admin/fighters/{id}", { as: fighter, params: { id: target.id } });
    assert.equal(r.status, 403);
    conforms(r, "delete", "/api/admin/fighters/{id}");
  });

  await check("documents: upload, list, download, delete, and an image upload", async () => {
    let r = await call("post", "/api/fighter/documents", { as: fighter, form: form({ type: "Medical" }, { bytes: PDF, name: "medical.pdf", type: "application/pdf" }) });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/fighter/documents");
    const documentId = (r.body as { data: { id: number } }).data.id;

    r = await call("post", "/api/fighter/documents", { as: fighter, form: form({ type: "Nonsense" }, { bytes: PDF, name: "medical.pdf", type: "application/pdf" }) });
    assert.equal(r.status, 400);
    conforms(r, "post", "/api/fighter/documents");
    r = await call("post", "/api/fighter/documents", { as: fighter, form: form({ type: "Medical" }, { bytes: Buffer.from("not a document at all"), name: "x.pdf", type: "application/pdf" }) });
    assert.equal(r.status, 415);
    conforms(r, "post", "/api/fighter/documents");
    r = await call("post", "/api/fighter/documents", { as: member, form: form({ type: "Medical" }, { bytes: PDF, name: "m.pdf", type: "application/pdf" }) });
    assert.equal(r.status, 403);
    conforms(r, "post", "/api/fighter/documents");

    r = await call("get", "/api/fighter/documents", { as: fighter });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/fighter/documents");

    r = await call("get", "/api/documents/{id}", { as: fighter, params: { id: documentId } });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/documents/{id}");
    r = await call("get", "/api/documents/{id}", { as: member, params: { id: documentId } });
    assert.equal(r.status, 404, "everyone but the owner and an admin gets 404");
    conforms(r, "get", "/api/documents/{id}");
    r = await call("get", "/api/documents/{id}", { as: null, params: { id: documentId } });
    conforms(r, "get", "/api/documents/{id}");

    r = await call("delete", "/api/fighter/documents/{id}", { as: fighter, params: { id: documentId } });
    assert.equal(r.status, 200);
    conforms(r, "delete", "/api/fighter/documents/{id}");
    r = await call("delete", "/api/fighter/documents/{id}", { as: fighter, params: { id: documentId } });
    assert.equal(r.status, 404);
    conforms(r, "delete", "/api/fighter/documents/{id}");

    r = await call("post", "/api/admin/uploads/image", { as: admin, form: form({}, { bytes: PNG, name: "face.png", type: "image/png" }) });
    assert.equal(r.status, 201);
    conforms(r, "post", "/api/admin/uploads/image");
    r = await call("post", "/api/admin/uploads/image", { as: member, form: form({}, { bytes: PNG, name: "face.png", type: "image/png" }) });
    assert.equal(r.status, 403);
    conforms(r, "post", "/api/admin/uploads/image");
  });

  await check("operator routes: health detail and the maintenance job, with and without their tokens", async () => {
    const token = "operator-token-0123456789-abcdefghijklmnopqrstuvwxyz";
    const auth = { authorization: `Bearer ${token}` };

    delete process.env.HEALTH_TOKEN;
    delete process.env.CRON_SECRET;
    let r = await call("get", "/api/health/detail", { headers: auth });
    assert.equal(r.status, 404);
    conforms(r, "get", "/api/health/detail");

    process.env.HEALTH_TOKEN = token;
    process.env.CRON_SECRET = token;
    r = await call("get", "/api/health/detail");
    assert.equal(r.status, 401);
    conforms(r, "get", "/api/health/detail");
    r = await call("get", "/api/health/detail", { headers: auth });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/health/detail");

    r = await call("get", "/api/cron/maintenance");
    assert.equal(r.status, 401);
    conforms(r, "get", "/api/cron/maintenance");
    r = await call("get", "/api/cron/maintenance", { headers: auth });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/cron/maintenance");

    r = await call("get", "/api/cron/outbox");
    assert.equal(r.status, 401);
    conforms(r, "get", "/api/cron/outbox");
    r = await call("get", "/api/cron/outbox", { headers: auth });
    assert.equal(r.status, 200);
    conforms(r, "get", "/api/cron/outbox");
    delete process.env.HEALTH_TOKEN;
    delete process.env.CRON_SECRET;
  });

  await check("a wrong method on every route is the documented JSON 405", async () => {
    for (const route of routes) {
      const wrong = (["get", "post", "put", "patch", "delete"] as Method[]).find((m) => !route.methods.includes(m) && m !== "put");
      if (!wrong) continue;
      const params = Object.fromEntries([...route.specPath.matchAll(/\{(\w+)\}/g)].map((m) => [m[1]!, 1]));
      const r = await call(wrong, route.specPath, { as: admin, params, body: wrong === "get" ? undefined : {} });
      assert.equal(r.status, 405, `${wrong.toUpperCase()} ${route.specPath}`);
      assert.match(String(r.headers.get("allow")), /OPTIONS/);
      const allowed = String(r.headers.get("allow")).split(", ");
      for (const m of route.methods) assert.ok(allowed.includes(m.toUpperCase()), `${route.specPath} allows ${m}`);
      assert.equal((r.body as { error: { code: string } }).error.code, "METHOD_NOT_ALLOWED");
    }
  });

  await check("the 429 is documented and carries Retry-After", async () => {
    const full = await sessionFor("filler04@demo.pfc.invalid");
    await testDb.rateLimitBucket.deleteMany();
    let last: Observed | undefined;
    for (let i = 0; i < 31; i++) {
      last = await call("post", "/api/bookings", { as: full, body: { slotId: 999999 } });
    }
    assert.equal(last!.status, 429);
    conforms(last!, "post", "/api/bookings");
    assert.ok(Number(last!.headers.get("retry-after")) >= 1);
  });

  // keep createBooking referenced so a signature change breaks this file loudly
  void createBooking;

  console.log(`\n${passed} checks passed\n`);
}

main()
  .then(() => testDb.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
