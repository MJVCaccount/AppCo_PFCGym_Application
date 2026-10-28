/**
 * The colour tokens are the single source of truth for the palette, so this
 * file is what makes that true rather than aspirational: it reads the real
 * :root block out of globals.css and checks every documented pairing against
 * the WCAG 2.1 thresholds. Change a token and the ratio is re-derived here, so
 * a well-meant tweak to the brand red cannot quietly drop a label below AA.
 *
 * Thresholds (WCAG 2.1 Level AA):
 *   1.4.3  normal text          4.5:1
 *   1.4.3  large text           3:1   (>=24px, or >=18.66px bold)
 *   1.4.11 non-text / UI parts  3:1   (borders, focus rings, control edges)
 *
 * CommonJS on purpose: the suite runs under `-r tsx/cjs`, so no top-level
 * await and no import.meta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CSS = path.resolve(__dirname, "..", "src", "app", "globals.css");
const css = fs.readFileSync(CSS, "utf8");

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok  " + label);
}

/* ---------- read the tokens out of the stylesheet ---------- */

const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(css);
assert.ok(rootBlock, "globals.css must declare a :root block");

const tokens = new Map<string, string>();
for (const line of rootBlock[1].split("\n")) {
  // Strip comments first: several tokens carry their ratio in a trailing one.
  const code = line.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = /^\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/.exec(code);
  if (m) tokens.set(m[1], m[2].toUpperCase());
}

function token(name: string): string {
  const value = tokens.get(name);
  assert.ok(value, `globals.css :root is missing ${name}`);
  return value;
}

/* ---------- WCAG relative luminance and contrast ---------- */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded down, so a value is never reported better than it is. */
function ratio(a: string, b: string): number {
  return Math.floor(contrast(a, b) * 100) / 100;
}

function meets(fg: string, bg: string, need: number, what: string) {
  const r = ratio(token(fg), token(bg));
  assert.ok(
    r >= need,
    `${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${need.toFixed(1)}:1`,
  );
}

/* ---------- the three surfaces text can land on ---------- */

const SURFACES = ["--bg", "--surface", "--surface-2", "--surface-3"];

/* ---------- 1.4.3 normal text, 4.5:1 ---------- */

check("body text clears AA on every surface", () => {
  for (const s of SURFACES) meets("--txt", s, 4.5, "body copy");
});

check("both muted greys clear AA on every surface", () => {
  for (const s of SURFACES) {
    meets("--mut", s, 4.5, "muted copy");
    meets("--mut-2", s, 4.5, "secondary muted copy");
  }
});

check("secondary text tokens clear AA on card surfaces", () => {
  for (const t of ["--txt-2", "--txt-3", "--txt-4"]) {
    for (const s of SURFACES) meets(t, s, 4.5, "secondary copy");
  }
});

check("--red-text clears AA on every surface, which --red does not", () => {
  for (const s of SURFACES) meets("--red-text", s, 4.5, "small red text");

  // The reason the second red exists. If this ever stops being true the
  // comment in globals.css is wrong and the two tokens can be merged.
  const onCard = ratio(token("--red"), token("--surface"));
  assert.ok(
    onCard < 4.5,
    `--red is now ${onCard.toFixed(2)}:1 on a card; if it clears 4.5 the ` +
      "--red-text split is no longer needed",
  );
});

check("status colours clear AA on every surface", () => {
  for (const s of SURFACES) {
    meets("--ok", s, 4.5, "success text");
    meets("--ok-soft", s, 4.5, "success text on a tinted panel");
    meets("--err-text", s, 4.5, "field error text");
    meets("--err-soft", s, 4.5, "error text on a tinted panel");
  }
});

check("white on the button fill clears AA", () => {
  meets("--txt", "--red-btn", 4.5, "button label");
  meets("--txt", "--red-hover", 4.5, "button label while hovered");
});

/* ---------- 1.4.3 large text, 3:1 ---------- */

check("brand red clears the large-text bar wherever display type sits", () => {
  // .hero h1 em at clamp(40px..) and the nav panel's 26px bold links.
  for (const s of ["--bg", "--surface", "--sunk"]) {
    meets("--red", s, 3, "display type");
  }
});

/* ---------- 1.4.11 non-text contrast, 3:1 ---------- */

check("a form control has a visible boundary on every surface it sits on", () => {
  // The fill alone cannot carry this, which is why --field-border exists.
  meets("--field-border", "--surface-3", 3, "input border against its own fill");
  for (const s of ["--bg", "--surface", "--surface-2"]) {
    meets("--field-border", s, 3, "input border against the surface behind it");
  }

  const fillOnly = ratio(token("--surface-3"), token("--surface"));
  assert.ok(
    fillOnly < 3,
    `--surface-3 on --surface is ${fillOnly.toFixed(2)}:1; if the fill now ` +
      "carries 3:1 on its own the explicit border is belt-and-braces",
  );
});

check("the focus ring clears 3:1 against the field and both backdrops", () => {
  meets("--red", "--surface-3", 3, "focus ring against the field fill");
  meets("--red", "--surface", 3, "focus ring against a card");
  meets("--red", "--bg", 3, "focus ring against the page");
});

check("the invalid-state border clears 3:1 against the field", () => {
  meets("--red-text", "--surface-3", 3, "aria-invalid border");
  meets("--red-text", "--surface", 3, "aria-invalid border against a card");
});

/* ---------- the tokens really are the single source ---------- */

check("no colour is written as a raw hex outside :root", () => {
  // Comments are stripped first: several of them quote a hex value to record
  // the ratio it was measured at, which is documentation, not a colour.
  const body = css
    .slice(rootBlock.index + rootBlock[0].length)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const stray = body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(
    stray,
    [],
    `these colours bypass the tokens: ${[...new Set(stray)].join(", ")}`,
  );
});

check("every colour token is referenced somewhere", () => {
  const unused = [...tokens.keys()].filter((t) => !css.includes(`var(${t})`));
  assert.deepEqual(unused, [], `unused colour tokens: ${unused.join(", ")}`);
});

console.log(`\n${passed} contrast checks passed`);
