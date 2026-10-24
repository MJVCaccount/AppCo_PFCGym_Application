# Accessibility audit — WCAG 2.1 Level AA

Front-end accessibility audit of the PFC Gym web application. This is a separate exercise from [`AUDIT.md`](AUDIT.md), which audits the back end for data, security and layering defects; nothing here overlaps with it.

**Target:** WCAG 2.1 Level AA.
**Scope:** everything the browser renders — `src/app/**`, `src/components/**`, `src/app/globals.css`. Server actions, repositories, Prisma and the API routes are out of scope except where their output reaches the user as a message.
**Owner:** front end (ST10450618).

## Method, and what it can and cannot show

Three passes, in this order.

1. **Manual source review** against the 50 Level A and AA success criteria, criterion by criterion, reading the markup and CSS behind every control, heading, image, table and live region.
2. **Computed contrast**, not eyeballed. Every colour pairing was put through the WCAG relative-luminance formula. The ratios quoted below are calculated, and rounded **down**, so no value here is reported better than it is.
3. **Regression tests**, so the findings stay fixed. The two new suites are described in §6; they run in `npm test`.

What this audit does **not** include is an assistive-technology pass: no screen reader was driven through the flows, and no browser-based tool (axe, Lighthouse, WAVE) was run, because neither could be installed in the environment the audit was carried out in. Several criteria can only be fully confirmed that way, and they are listed as unverified in §5 rather than claimed as passes. Marking them as passing on the strength of a source reading would be guessing.

## Summary

| Severity | Found | Fixed | Open |
| --- | --- | --- | --- |
| Fail — Level AA | 7 | 7 | 0 |
| Fail — Level A | 2 | 2 | 0 |
| Risk — best practice, not a conformance failure | 3 | 3 | 0 |
| **Total** | **12** | **12** | **0** |

The design was in good shape before this audit: mobile-first layout with tablet and desktop breakpoints, a working skip link, `prefers-reduced-motion`, `lang="en-ZA"`, alt text on all nine images, `scope` on table headers, and a documented token palette. The failures below are concentrated in two places: **colour tokens that were measured against the wrong background**, and **error messages that were displayed but not associated with a control**.

---

## 1. Errors not associated with their controls — Fail, 1.3.1 (A), 3.3.1 (A), 4.1.2 (A)

The defect the marker identified, and the largest single finding.

### 1.1 The document upload form

`src/components/DocumentUploadForm.tsx` rendered a document-type `<select>` and a file `<input>`, and a single error message in a `<div className="field--full">` of its own below them:

```jsx
<select id="doc-type" name="type">…</select>
<input id="doc-file" name="file" type="file" … />
…
<div className="field--full">
  <span className="error" role="alert">{error}</span>
</div>
```

Neither control carried `aria-describedby` or `aria-invalid`. Three consequences:

* "Choose a file to upload" was announced with no indication of **which** of the two controls was at fault.
* Moving focus to the file input announced nothing — not the error, and not the "PDF, JPEG or PNG, up to 4 MB" constraint, which was inside the `<label>` and so became part of the control's *name* rather than its description.
* `aria-invalid` was never set, so the control reported itself as valid while displaying an error.

**Fixed.** The form now holds one error per control (`{ type?, file?, form? }`) and routes both controls through the shared field layer. A server error is attributed by status code: 400 and 413 are the route rejecting the file, so the message goes on the file input; anything else (an expired session, a server fault) goes to a form-level `Alert`, because attributing it to a control would send the user to fix the wrong thing. Focus moves to the field that failed.

### 1.2 The same defect in the admin image upload

`src/components/admin/ImageUploadField.tsx` had it worse. One `<span className="error">` served as both the progress message and the error message, with its `role` swapped between `status` and `alert` as the state changed:

```jsx
<span className="error" role={failed ? "alert" : "status"} …>{message}</span>
```

A live region is registered when its node enters the document, so **a role swapped onto a node already in the tree is not reliably honoured**. In practice the success and progress messages may never announce, and the errors may announce politely when they should interrupt. Nothing referenced the node either, and the size constraint was again inside the `<label>`.

**Fixed.** Progress and success now live in the hint slot — a live region, because its text changes — and failures in the error slot, which is permanently `role="alert"`. Both are named by the input's `aria-describedby`.

### 1.3 A plan select with half the wiring

`src/components/RegisterForm.tsx` had `aria-invalid` on its membership-plan `<select>` but no `aria-describedby`, so the error rendered below it was never associated with it. **Fixed** by moving it onto `SelectField`.

### 1.4 Two orphaned error nodes

* `src/components/DocumentList.tsx` rendered a bare `.error` span above the list for delete failures. It belongs to the list, not to a control, and had no id for anything to reference. **Fixed:** it is now an `Alert`, which is the site's primitive for exactly this and already carries `role="alert"`.
* `src/app/admin/members/page.tsx` carried an error span that nothing ever wrote to. **Fixed:** removed.

### Why the fix is a layer, not six patches

Each of these was the same mistake made separately, which is the signal to move the rule into one place. All six control types now go through `Field.tsx` / `CheckField.tsx`, and `aria-describedby` is **stable** — it names the hint and error nodes whether or not they currently hold text:

```tsx
export function fieldIds(name: string, scope?: string): FieldIds {
  const control = scope ? `f-${scope}-${name}` : `f-${name}`;
  …
  return { control, hint, error, describedBy: `${hint} ${error}` };
}
```

The common alternative — adding `aria-describedby` at the moment an error appears — is unreliable, because several screen readers cache a control's description when it receives focus and never see an attribute added afterwards. An always-present reference to an empty node costs nothing and always works. The nodes are therefore rendered unconditionally, and `.field__hint:empty` collapses so an absent hint takes no space.

## 2. Duplicate ids where a form renders more than once — Fail, 4.1.1 (A), 1.3.1 (A)

Found while fixing §1, and not visible from any single file.

Four pages render several copies of the same form, and every field derived its id from the field name alone:

| Page | Copies of the form | Fields each |
| --- | --- | --- |
| `app/admin/classes/page.tsx` | 4 | 10 |
| `app/admin/coaches/page.tsx` | 2 | 8 |
| `app/admin/events/page.tsx` | 2 | 8 |
| `app/admin/plans/page.tsx` | 2 | 3 |

So `/admin/classes` served up to **40 duplicate ids**. A browser resolves `htmlFor` and `aria-describedby` to the *first* matching element, so every label and every error message on that page pointed at the first form's inputs: clicking the fourth form's "Day" label focused the first form's, and an error on the fourth announced against the first.

**Fixed.** `fieldIds` takes an optional `scope`, and those four forms pass the record id (`initial?.id ?? "new"`). Single-instance forms keep the plain `f-<name>` ids already in use elsewhere, so no existing `htmlFor="f-planId"` breaks. `ImageUploadField` uses `useId()` because it receives no record id and two of them render on `/admin/events`.

## 3. Colour tokens measured against the wrong background — Fail, 1.4.3 (AA), 1.4.11 (AA)

The palette was documented, which is what made these findings easy: the ratio in the comment was right, and the background it was measured against was not.

### 3.1 Brand red as small text — 1.4.3

`--red: #FF0000` was documented as "text/borders on black, 5.25:1". That is correct **on black**. Most red text on the site is not on black, it is on a card:

| Background | Ratio | Needs | |
| --- | --- | --- | --- |
| `--bg` `#000000` | 5.25:1 | 4.5:1 | pass |
| `--surface` `#171717` | 4.48:1 | 4.5:1 | **fail** |
| `--surface-2` `#1F1F1F` | 4.12:1 | 4.5:1 | **fail** |
| `--surface-3` `#252525` | 3.83:1 | 4.5:1 | **fail** |

Eleven rules used it as text. Nine were small text on a card: `.eyebrow` (10px), `.btn--ghost` (13px), `.hero__meta .price` (13px), `.coach__role` (10px), `.slot__time b` (16px bold — **not** large text, which starts at 18.66px bold), `.stars`, `.quote time` (11px), `.auth__alt a`, and the desktop nav's current-page link (12px).

**Fixed** by splitting the token by role, which is the only way one hue can serve both:

* `--red: #FF0000` — borders, fills, icons, `accent-color`, the focus ring, and hero display type. All non-text or large text, where the bar is 3:1, and it clears that on every surface.
* `--red-text: #FF4D4D` — small red text. 6.42:1 on the page, 5.48:1 on a card, 5.04:1 on `--surface-2`, 4.69:1 on `--surface-3`, so it passes wherever it lands.

The focus ring deliberately keeps `--red`: at 3.83:1 against the field fill it is comfortably above the 3:1 that 1.4.11 asks of an indicator, and `outline-offset: 2px` puts it on the surface behind the control rather than on the control.

### 3.2 Form controls with no visible boundary — 1.4.11

Inputs were `background: var(--surface-3); border: 1.5px solid transparent`. The fill was the only thing marking the control, and **`--surface-3` against a `--surface` card is 1.17:1** — far below the 3:1 that 1.4.11 requires of a control's boundary. On a card the edge of a text field was essentially invisible.

**Fixed** with `--field-border: #707070`, which clears 3:1 against the fill *and* every surface a field sits on: 3.10:1 vs `--surface-3`, 3.62:1 vs a card, 3.33:1 vs `--surface-2`, 4.24:1 vs the page. `.admin-actions select` had the same transparent border and is fixed with it.

### 3.3 Nav panel ordinals at 1.6:1 — 1.4.3

`.navpanel__list a span` — the `01`, `02`, `03` beside each mobile nav link — was `#333` on the panel's near-black background: **1.61:1**, the worst ratio in the stylesheet. **Fixed** to `--mut-2`, which is 6.25:1 there.

### 3.4 Select left out of the invalid state — Risk

`.field input[aria-invalid="true"]` and the `textarea` equivalent set a red border; `select` was not in the selector, so an invalid dropdown announced as invalid but did not look it, leaving colour the only channel that disagreed. **Fixed** by adding the selector.

## 4. Structure and markup

### 4.1 Most pages had no `h1` — Fail, 2.4.6 (AA), 1.3.1 (A)

19 of the 27 routes opened with an `<h2>` and had no `<h1>` anywhere. A screen reader user jumping by heading — one of the two most common ways of orienting on a page — found no heading naming the page, and the heading order started at level 2.

**Fixed.** Each page's first heading is now its `h1`. This is a markup change only: `h1` had no size rule of its own, so `h1, h2 { font-size: var(--fs-h2) }` keeps every page looking exactly as it did, and `.hero h1` still overrides with the display size. Two routes keep no `h1` and both are correct: `app/admin/page.tsx` only redirects, and `app/dashboard/page.tsx` delegates to the four role dashboards, each of which now carries one.

### 4.2 A hint inside a label became part of the control's name — Fail, 2.5.3 (A) risk, 1.3.1 (A)

`TextField` put its hint inside the `<label>`, so a field labelled "Phone" with the hint "Optional" had the accessible name **"Phone Optional"**. The same pattern put "(PDF, JPEG or PNG, up to 4 MB)" and "(JPEG, PNG or WebP, up to 2 MB)" into the names of the two file inputs. A name that does not match the visible label also undermines 2.5.3 Label in Name for anyone using voice control.

**Fixed.** The hint moved to its own node, which is a description, not part of the name.

### 4.3 A checkbox with two labels — Fail, 4.1.2 (A)

`PlanForm` stacked two `<label>` elements on one checkbox — `"Highlight"` and `"Most popular plan"`, both with the same `htmlFor`. When more than one label references a control, the accessible name is all of them joined, so it announced as **"Highlight Most popular plan"**. Its error span had no id and nothing referenced it.

**Fixed** with a `CheckField` component: the heading is a `.field__legend` span, which is not a label, leaving one label and one name. It does not sit inside `Field`, because `Field` renders the label before the control and a checkbox's label belongs after it.

### 4.4 A honeypot visible to screen readers — Risk, 3.3.2 (A)

`ContactForm`'s spam trap is positioned off-screen, which hides it from sighted users. A screen reader reads the accessibility tree, not the layout, so a screen reader user met a text field labelled **"Leave this field empty"** — and filling it in would have had a legitimate enquiry silently rejected.

**Fixed** with `aria-hidden="true"` on the field and its label, keeping `tabIndex={-1}`. The trap still works: a bot reading the raw DOM finds it, and no human using assistive technology meets it.

### 4.5 A live region on a static hint — Risk

Giving every hint node `role="status"` would make moving between pages chatty, since a static hint would announce on insertion. The role is therefore opt-in, through a `liveHint` prop, and set only on the two fields whose hint actually changes while in use: `FileField` (the chosen file name) and `ImageUploadField` (upload progress). **Resolved by design** rather than found as a defect.

## 5. Verified compliant, and not verified

### Confirmed by source review

| Criterion | Evidence |
| --- | --- |
| 1.1.1 Non-text content (A) | all 9 `<Image>`/`<img>` carry `alt`; decorative logos use `alt=""` |
| 1.3.1 Relationships (A) | 11 tables, 66 `<th>`, `scope` on each; `<dl>` used for fact lists |
| 1.3.5 Identify input purpose (AA) | `autoComplete` on 18 controls across the auth and contact forms |
| 2.1.1 Keyboard (A) | no `onMouseOver`/`onClick` handler on a non-interactive element |
| 2.4.1 Bypass blocks (A) | `.skip-link` in `layout.tsx` targets `<main id="main">` |
| 2.4.2 Page titled (A) | `metadata.title` per route |
| 2.4.7 Focus visible (AA) | global `:focus-visible` 3px ring, `outline-offset: 3px` |
| 2.5.8 Target size (AA) | `.btn` 48px, `.btn--sm` 40px, both above the 24px minimum |
| 3.1.1 Language of page (A) | `lang="en-ZA"` |
| 4.1.3 Status messages (AA) | `Alert` splits `role="status"` for confirmations from `role="alert"` for errors |
| 2.3.3 Animation from interactions (AAA) | `prefers-reduced-motion: reduce` collapses every transition |

### Needs an assistive-technology pass to confirm

These are not claimed as passes. They depend on runtime behaviour a source reading cannot settle:

* **1.4.10 Reflow (AA)** — needs measuring at 320px and at 400% zoom.
* **1.4.13 Content on hover or focus (AA)** — the sticky CTA and nav panel need checking for dismissability.
* **2.4.3 Focus order (A)** — the nav panel is a transformed, visibility-toggled overlay; whether focus is trapped and returned needs a keyboard pass.
* **4.1.2 announcement order** — that each error is read with its field, in the right order, on at least NVDA and VoiceOver.
* The focus ring's visibility where `outline-offset` may be clipped by an `overflow: hidden` ancestor.

**Recommended next step:** run axe DevTools over the twelve main routes plus the four dashboards, then a keyboard-only pass of the booking, registration and upload flows. That is roughly an afternoon and would close the list above.

## 6. Keeping it fixed

Two suites were added to `npm test`, both pure source scans — no database, no network — so they run first and fail fast.

**`tests/contrast.test.ts`** — 12 checks. Reads the real `:root` block out of `globals.css` and re-derives every documented ratio, so a well-meant tweak to the brand red cannot quietly drop a label below AA. It also asserts the two facts that justify the token split, and fails if they stop being true:

```
--red is now X:1 on a card; if it clears 4.5 the --red-text split is no longer needed
--surface-3 on --surface is X:1; if the fill now carries 3:1 the explicit border is belt-and-braces
```

Last, it enforces the marker's forward-looking note — *keep the tokens as the single source as the UI grows* — mechanically: **no colour may be written as a raw hex outside `:root`**, and every colour token must be referenced somewhere. The sweep that made this pass replaced 56 raw hex values with tokens; the stylesheet now has none.

**`tests/a11y-fields.test.ts`** — 10 checks on the real `.tsx` sources, because a fix only holds if the next field added cannot skip it:

* every `.error` node has an id, so a control *can* point at it — the §1 defect stated as a rule
* a control in a file that shows errors is wired to one
* a described control also reports `aria-invalid`
* the hint and error nodes are rendered unconditionally, and not as `{error && …}`
* `fieldIds` namespaces ids when given a scope, and `describedBy` always names both nodes
* every field component derives its ids from `fieldIds` rather than inventing them
* no control is given two labels
* exactly one `h1` per route, and it is the page's first heading

## Changes made

| File | Change |
| --- | --- |
| `src/lib/field-ids.ts` | new — the id scheme, extracted as a pure function so it is importable without JSX |
| `src/components/Field.tsx` | the shared contract; `footer` and `liveHint` slots; re-exports `fieldIds` |
| `src/components/CheckField.tsx` | new — checkbox, one label, wired error |
| `src/components/FileField.tsx` | new — file input, wired error, announces the chosen file |
| `src/components/TextField.tsx` | moved onto `Field`; hint out of the label; `scope` |
| `src/components/SelectField.tsx` | moved onto `Field`; `scope`; kept the `key={defaultValue}` remount |
| `src/components/PasswordField.tsx` | moved onto `Field`; `aria-pressed` and `aria-controls` on the toggle |
| `src/components/DocumentUploadForm.tsx` | per-control errors; server errors attributed by status |
| `src/components/admin/ImageUploadField.tsx` | progress and errors split into two nodes, both referenced |
| `src/components/RegisterForm.tsx` | plan select moved onto `SelectField` |
| `src/components/ContactForm.tsx` | honeypot taken out of the accessibility tree |
| `src/components/DocumentList.tsx` | orphaned error span replaced with `Alert` |
| `src/components/admin/{Class,Coach,Event,Plan}Form.tsx` | pass `scope`; `PlanForm` uses `CheckField` |
| `src/app/**/page.tsx`, `src/app/dashboard/*Dashboard.tsx` | first heading promoted to `h1` (22 files) |
| `src/app/globals.css` | `--red-text`, `--field-border` and 16 further tokens (30 colour tokens in all); nav ordinal; field border; hint, legend and file-input styles; `h1` sizing; 56 raw hex values swept |
| `tests/contrast.test.ts`, `tests/a11y-fields.test.ts` | new — 22 regression checks |
