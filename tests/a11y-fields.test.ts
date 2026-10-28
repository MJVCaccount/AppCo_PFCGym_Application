/**
 * Guards the form-field accessibility contract against regression.
 *
 * The marker's note was "link upload errors to their inputs with
 * aria-describedby". That was fixed by routing every control through
 * Field.tsx, but a fix only holds if the next field added cannot skip it — so
 * this reads the real .tsx sources and fails if a control appears that is
 * neither wired nor deliberately exempt.
 *
 * It is a source scan rather than a render test on purpose: the suite runs
 * without a DOM, and the property being checked is a property of the markup
 * we write, not of a particular render.
 *
 * CommonJS on purpose: the suite runs under `-r tsx/cjs`, so no top-level
 * await and no import.meta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fieldIds } from "../src/lib/field-ids";

const SRC = path.resolve(__dirname, "..", "src");

/** The components that own the wiring; they are checked, not exempted. */
const FIELD_COMPONENTS = [
  "Field.tsx",
  "TextField.tsx",
  "SelectField.tsx",
  "PasswordField.tsx",
  "FileField.tsx",
  "CheckField.tsx",
];

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = walk(SRC).sort();
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

/**
 * Splits a file into its JSX opening tags for input, select and textarea.
 * Tags span several lines, so this walks from each `<input` to its closing
 * `>` rather than working line by line.
 */
function controls(source: string): { tag: string; text: string; line: number }[] {
  const found: { tag: string; text: string; line: number }[] = [];
  const re = /<(input|select|textarea)(?=[\s/>])/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(source))) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    found.push({
      tag: m[1]!,
      text: source.slice(m.index, end + 1),
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return found;
}

/* ---------- no error message is left floating ---------- */

check("every error node has an id so a control can point at it", () => {
  // This is the marker's note stated as a rule. The upload form used to render
  // `<span className="error" role="alert">` in a div of its own, with nothing
  // referencing it: the message was on screen but belonged to no control. An
  // error node without an id cannot be referenced, so it is the thing to ban.
  const orphans: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const re = /<span[^>]*className="error"[^>]*>/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(source))) {
      if (/\bid=/.test(m[0])) continue;
      orphans.push(`${rel(file)}:${source.slice(0, m.index).split("\n").length}`);
    }
  }

  assert.deepEqual(
    orphans,
    [],
    "error nodes that no control can reference:\n    " + orphans.join("\n    "),
  );
});

check("a control rendered beside an error node references it", () => {
  // A hand-written field is allowed, but not one that shows an error without
  // wiring it. Controls with nothing to describe — a hidden input, a search
  // box that cannot fail — are not required to carry the attribute.
  const unwired: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (!/className="error"/.test(source)) continue;
    // The field components are where the wiring lives; checked separately.
    if (FIELD_COMPONENTS.includes(path.basename(file))) continue;

    for (const c of controls(source)) {
      if (/type=["']hidden["']/.test(c.text)) continue;
      if (c.text.includes('aria-hidden="true"')) continue;
      if (c.text.includes("aria-describedby")) continue;
      // Attributes supplied by a spread, e.g. {...shared} in TextField.
      if (c.text.includes("{...") && source.includes("aria-describedby")) continue;

      unwired.push(`${rel(file)}:${c.line} <${c.tag}>`);
    }
  }

  assert.deepEqual(
    unwired,
    [],
    "controls in a file that shows errors, but not wired to one:\n    " +
      unwired.join("\n    "),
  );
});

check("a described control also reports its validity with aria-invalid", () => {
  const missing: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const c of controls(source)) {
      if (!c.text.includes("aria-describedby")) continue;
      if (c.text.includes("aria-invalid")) continue;
      missing.push(`${rel(file)}:${c.line} <${c.tag}>`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    "described but no aria-invalid:\n    " + missing.join("\n    "),
  );
});

/* ---------- the ids the wiring depends on ---------- */

check("the hint and error nodes are rendered unconditionally", () => {
  // The whole point of the contract: aria-describedby names ids that must
  // always resolve, because several screen readers cache a control's
  // description at focus time and never see one added afterwards.
  for (const name of ["Field.tsx", "CheckField.tsx"]) {
    const source = fs.readFileSync(path.join(SRC, "components", name), "utf8");

    assert.match(
      source,
      /id=\{ids\.hint\}/,
      `${name} must render the hint node`,
    );
    assert.match(
      source,
      /id=\{ids\.error\}/,
      `${name} must render the error node`,
    );
    // `{error && <span .../>}` would mount the node only once there is an
    // error, which is the pattern this contract exists to avoid.
    assert.ok(
      !/\{\s*error\s*&&\s*</.test(source),
      `${name} must not render the error node conditionally`,
    );
    assert.match(
      source,
      /role="alert"/,
      `${name}'s error node must announce when it appears`,
    );
  }
});

check("fieldIds namespaces ids when a scope is given", () => {
  const plain = fieldIds("email");
  assert.equal(plain.control, "f-email");
  assert.equal(plain.describedBy, "f-email-hint f-email-error");

  // Four copies of one form render on /admin/classes; without a scope they
  // would all claim the same ids and every label would resolve to the first.
  const a = fieldIds("name", "12");
  const b = fieldIds("name", "new");
  assert.equal(a.control, "f-12-name");
  assert.notEqual(a.control, b.control);
  assert.notEqual(a.describedBy, b.describedBy);

  // describedBy must name both nodes, in that order, for every call shape.
  for (const ids of [plain, a, b]) {
    assert.equal(ids.describedBy, `${ids.hint} ${ids.error}`);
  }
});

check("the field components all route through fieldIds", () => {
  for (const name of FIELD_COMPONENTS) {
    if (name === "Field.tsx") continue;
    const source = fs.readFileSync(path.join(SRC, "components", name), "utf8");
    assert.match(
      source,
      /fieldIds\(/,
      `${name} must derive its ids from fieldIds, not invent them`,
    );
  }
});

/* ---------- labels ---------- */

check("no control is given two labels at once", () => {
  // Two <label> elements pointing at one control make the accessible name the
  // two joined together: a checkbox once announced as "Highlight Most popular
  // plan". A heading above a labelled control is .field__legend, not a label.
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const forAttrs = [...source.matchAll(/htmlFor=\{?([^}\s>]+)\}?/g)].map(
      (m) => m[1],
    );
    const seen = new Set<string>();
    const doubled = forAttrs.filter((a) => {
      if (seen.has(a!)) return true;
      seen.add(a!);
      return false;
    });
    assert.deepEqual(
      doubled,
      [],
      `${rel(file)} points two labels at: ${doubled.join(", ")}`,
    );
  }
});

/* ---------- heading structure ---------- */

check("no file renders two h1 elements", () => {
  // WCAG 2.4.6 and 1.3.1: one heading names the page, and a screen reader
  // user jumping by heading should land on it. Most pages opened with an
  // <h2> and no <h1> at all before this was fixed.
  const doubled: string[] = [];

  for (const file of files) {
    const count = (fs.readFileSync(file, "utf8").match(/<h1[\s>]/g) ?? []).length;
    if (count > 1) doubled.push(`${rel(file)} (${count})`);
  }

  assert.deepEqual(doubled, [], "more than one h1:\n    " + doubled.join("\n    "));
});

check("every route has an h1, bar two that render no markup of their own", () => {
  // admin/page.tsx only redirects, and dashboard/page.tsx delegates to the
  // four role dashboards, each of which carries its own h1.
  const EXEMPT = new Set(["app/admin/page.tsx", "app/dashboard/page.tsx"]);
  const missing: string[] = [];

  for (const file of files) {
    const name = rel(file);
    if (!name.endsWith("/page.tsx")) continue;
    if (EXEMPT.has(name)) continue;
    if (/<h1[\s>]/.test(fs.readFileSync(file, "utf8"))) continue;
    missing.push(name);
  }

  assert.deepEqual(missing, [], "routes with no h1:\n    " + missing.join("\n    "));
});

check("a page's first heading is its h1, not a lower level", () => {
  const wrong: string[] = [];

  for (const file of files) {
    const name = rel(file);
    if (!name.endsWith("/page.tsx")) continue;
    const source = fs.readFileSync(file, "utf8");
    const first = /<h([1-6])[\s>]/.exec(source);
    if (!first || first[1] === "1") continue;
    wrong.push(`${name} opens with h${first[1]}`);
  }

  assert.deepEqual(wrong, [], "heading order:\n    " + wrong.join("\n    "));
});

console.log(`\n${passed} field accessibility checks passed`);
