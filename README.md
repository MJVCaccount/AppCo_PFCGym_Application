# PFC - Professional Fighting Championship

Next.js 15 application for the Professional Fighting Championship gym in
Bothasig, Cape Town (INSY7315 Work Integrated Learning): public site, member
bookings, fighter bout offers and documents, coach attendance, and an admin
area. PostgreSQL on Neon through Prisma 6, custom cookie sessions, server
actions and JSON routes, deployed to Vercel by GitHub Actions.

**Client:** Professional Fighting Championship, Bothasig, Cape Town
**Team:** Seth Oliver (desktop), Ruan Cupido (mobile)

---

## Running it

Requires Node 20 or newer (what CI uses) and a PostgreSQL database.

```bash
npm install                  # also runs prisma generate
cp .env.example .env         # then fill it in, see "Environment variables"
npx prisma migrate deploy    # create the tables
npm run db:seed              # demo data, see "Demo accounts"
npm run dev                  # http://localhost:3000
```

### npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build, and serve it |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | All 16 test files (471 checks), against `TEST_DATABASE_URL` (empties every table there) |
| `npm run ci` | lint, typecheck, test and build, as CI does |
| `npm run db:migrate` | `prisma migrate dev` (create a migration) |
| `npm run db:deploy` | `prisma migrate deploy` (apply migrations) |
| `npm run db:seed` | Seed demo data; refuses databases that are not allow-listed |
| `npm run db:reset` | `prisma migrate reset --force`: wipes the database, then seeds. Local use only |
| `npm run db:counts` | Row count per table |
| `npm run smoke -- <url> [--expect-seed]` | Post-deploy smoke test against a running deployment |

### Demo accounts

**These accounts and their passwords exist for the module demonstration only.**
The passwords below are published in this public repository, so they are valid
for **localhost and the dev database only**. A hosted database needs its own:
the seed refuses to run against it unless `SEED_ADMIN_PASSWORD` (for
`admin@pfc.co.za`) and `SEED_DEMO_PASSWORD` (for the member, fighter and two
demo coaches) are set, each at least 12 characters, different from each other
and from the published ones. The seed re-applies passwords every time it runs;
never run it against a database real members use.

| Email | Password | Role | Notes |
|---|---|---|---|
| `member@pfc.co.za` | `Member123!` | Member | John Wick, on the R900 plan |
| `fighter@pfc.co.za` | `Fighter123!` | Fighter | Demo Fighter, Welterweight, 3-1-0, one pending offer for PFC Fight Night |
| `marcus@pfc.co.za` | `Coach123!` | Coach | Marcus Thompson, head boxing coach |
| `sofia@pfc.co.za` | `Coach123!` | Coach | Sofia Erasmus, Muay Thai and MMA |
| `admin@pfc.co.za` | `Admin123!` | Admin | Ruan Cupido |

The seed also creates four more coaches, `jake@`, `priya@`, `leon@` and
`maurice@pfc.co.za` (Jake Morrison, Priya Nakamura, Leon Baptiste, Maurice
Joseph). Their passwords are random and unknown: use "Forgot password" or an
admin's "Resend invite" to sign in as one. 24 filler members
(`fillerNN@demo.pfc.invalid`, unusable passwords) only make the timetable show
booked counts, and the two demo events (PFC Fight Night, PFC Regional
Championship) start at 19:00 Johannesburg time.

All roles use the same `/dashboard` URL; the session's role picks the view.
Staff pages are under `/admin` (admin) and `/coach` (coach or admin).

---

## Environment variables

Every variable the code reads. Copy `.env.example` to `.env` (local) or set them in Vercel
(Project, Settings, Environment Variables), separately for Production and Preview.

| Variable | Needed | What it is for |
|---|---|---|
| `SESSION_SECRET` | Always in production | Signs the session cookie; at least 32 characters. A production server refuses to start without it. Locally a throwaway value is used if it is unset |
| `DATABASE_URL` | Yes | Pooled Neon connection string (host contains `-pooler`), used by the running app |
| `DIRECT_URL` | Yes | Direct, non-pooled string, used by `prisma migrate` and the seed |
| `APP_URL` | Production | Public base URL, no trailing slash, `https://` in production. Builds every link in emails and is what the same-origin check compares against |
| `RESEND_API_KEY`, `EMAIL_FROM` | For email | Resend key and the verified From address. Without them no email is sent and the app keeps working |
| `CONTACT_INBOX` | For the contact form email | Where enquiries are delivered |
| `PUBLIC_BLOB_STORE_ID` | For image uploads | Vercel Blob store for coach and event images (public) |
| `PRIVATE_BLOB_STORE_ID` | For documents | Vercel Blob store for fighters' medical and licence documents (private) |
| `PUBLIC_BLOB_READ_WRITE_TOKEN`, `PRIVATE_BLOB_READ_WRITE_TOKEN` | Local only | Optional tokens for the two stores; leave blank on Vercel (it uses OIDC) |
| `CSP_REPORT_ONLY` | No | `1` sends the Content-Security-Policy as report-only |
| `RATE_LIMIT_MULTIPLIER` | No | Whole number 1 to 20 (default 1, anything else ignored). Multiplies every rate limit, for a busy day such as the EXPO when a crowd shares one network address. Set it in the Vercel dashboard; set it back to 1 afterwards |
| `SEED_ALLOWED_HOSTS` | Local | Hosts the seed may write to besides localhost (the Neon dev host) |
| `SEED_CONFIRM_HOST` | One command | The host of a database to seed once on purpose; never saved in a file |
| `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | Required when seeding a hosted database | Passwords for the demo accounts instead of the published ones (12+ characters, different from each other and from the published ones). Optional on localhost and in `SEED_ALLOWED_HOSTS`; one command only |
| `TEST_DATABASE_URL` | Tests | A separate database for `npm test`. The tests empty every table and refuse the same database as `DATABASE_URL` or `DIRECT_URL` |
| `SMOKE_BYPASS_SECRET` | Smoke test | Vercel's deployment-protection bypass secret, only if protection is on |

Set by the platform, never by you: `NODE_ENV`, `NEXT_RUNTIME`, `NEXT_PHASE`,
`VERCEL_OIDC_TOKEN`. The GitHub Actions secrets and variables are listed under
Deployment below.

---

## Structure

```
├── src/
│   ├── app/                  App Router, one folder per route
│   │   ├── page.tsx, classes/, coaches/, memberships/, timetable/, events/,
│   │   │   contact/, promo/, login/, register/, forgot-password/,
│   │   │   reset-password/[token]/, denied/
│   │   ├── dashboard/        one URL, Member / Fighter / Coach / Admin view by role
│   │   ├── bookings/         a member's bookings
│   │   ├── coach/classes/[id]/   roster and attendance
│   │   ├── admin/            classes, coaches, members, fighters, events, plans,
│   │   │                     documents, enquiries, audit
│   │   └── api/              JSON routes (bookings, fighter, documents, admin,
│   │                         classes, timetable, events, health)
│   ├── actions/              server actions: auth, gym, coach, fighter, admin
│   ├── components/           header/nav, footer, cards, form fields, admin forms
│   ├── lib/
│   │   ├── services/         business rules and authorisation (the role check lives here)
│   │   ├── repositories/     all Prisma access; transactions and row locks
│   │   ├── email/            templates (escaped), queue (after the response), Resend send
│   │   ├── validation.ts     shared form rules; text.ts: optionalText()
│   │   ├── session.ts, sessionToken.ts   signed cookie sessions with revocation
│   │   ├── rateLimit.ts, origin.ts, csp.ts, json.ts, api.ts   request hardening
│   │   ├── uploads.ts        upload checks and the two Blob stores
│   │   ├── dates.ts          everything in Africa/Johannesburg time
│   │   └── logger.ts         the only place that writes to stdout or stderr
│   ├── middleware.ts         page gate and the per-request CSP nonce
│   └── instrumentation.ts    start-up checks (APP_URL, SESSION_SECRET)
├── prisma/                   schema.prisma, migrations/, seed.ts, seedGuard.ts
├── tests/                    16 test files and their helpers and stubs
├── scripts/smoke.mjs         post-deploy smoke test
├── docs/                     OPERATIONS.md (running the system), AUDIT.md (final audit)
├── .github/                  CI and deploy workflows, pull request template
└── public/images/            optimised photos of the client's facility
```

---

## One codebase, both breakpoints

Desktop and mobile are the same components and the same stylesheet. There is no
separate mobile site to keep in sync. `globals.css` is mobile-first: the base
rules are the phone layout, and two media queries add complexity as the viewport
grows.

| Breakpoint | Width | What changes |
|---|---|---|
| Base | 0–767px | Single column. Hamburger nav. Card rows become horizontal snap-scrollers. Stats 2-up. Popular plan first. Footer collapses to accordions. Sticky Join CTA. |
| Tablet | ≥768px | Scrollers become 2-column grids. Stats 3-up. Plans 3-across, popular one back in the middle. Footer opens to 3 columns. |
| Desktop | ≥1024px | Inline nav replaces the hamburger. 3-column grids. Dashboard gains its fixed sidebar. Sticky CTA hidden. |

Test by dragging the window, or Chrome DevTools → `Ctrl+Shift+M`.

---

## Architecture notes

**Layers.** A page or action never touches Prisma. Pages and actions call a
service (`src/lib/services`), which validates, checks the caller's role and
applies the business rules, and which calls a repository
(`src/lib/repositories`), the only code that imports Prisma. Anything that
depends on a prior read (capacity, uniqueness, status changes) runs inside
`prisma.$transaction`, usually with a row lock (`FOR UPDATE`). Unique and
not-found errors (P2002, P2025) are mapped to 409 and 404 in
`src/lib/errors.ts`; every other error is logged and answered with a fixed
sentence, so no SQL or stack trace reaches a client.

**Server components by default.** Pages render on the server and ship no
JavaScript for their content. Components opt into the client only where they
need state: the nav overlay, forms using `useActionState`, the upload forms,
the password toggle, the submit button and the scroll reveal.

**Server actions and JSON routes.** Forms post to server actions (Next adds an
origin check). The same services back the JSON routes under `/api`, for a
mobile client or an external caller. Every success is `{ "data": ... }` and
every error `{ "error": { "message": ... } }`.

**Validation runs on the server, always.** `src/lib/validation.ts` holds the
rules and `src/lib/text.ts` the shared `optionalText()`: an optional input may
be missing, null or empty. Whole numbers are checked to be integers in range.
With JavaScript off a form still posts, validates and shows its errors.

**Money is whole rands** (`Int`); there is no Decimal anywhere. Nothing with a
Date or Decimal is handed to a client component: repositories map rows to the
plain types in `src/lib/types.ts`.

**Time is Africa/Johannesburg.** Class days, session dates and "has it
started" are read through `Intl` with that zone, never the server's clock
(Vercel runs in UTC).

**Every page and route that reads user-specific or changing data exports
`dynamic = "force-dynamic"`.** `server-only` is imported by server modules, so
importing one into a client component fails the build.

---

## Security

**Passwords** are hashed with scrypt, deliberately slow and memory-hard, so a
stolen hash list resists offline brute force. Every account gets its own random
salt, so two people choosing the same password still store different hashes.
Comparison is fixed-time (`timingSafeEqual`), and an unknown email still runs
one hash before failing, so response timing cannot reveal which addresses are
registered.

**Sessions** are a cookie signed with HMAC-SHA256. Editing the payload to claim
a different role breaks the signature and the session is rejected, there is a
test for exactly this. The cookie is `httpOnly` (JavaScript cannot read it),
`sameSite=lax` (not sent on cross-site POSTs, which blocks CSRF) and `secure`
outside development.

**`SESSION_SECRET`** must be set in production; the app refuses to start
without it. Copy `.env.example` to `.env.local` and generate one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Open redirects** are blocked: `returnUrl` is followed only when it is a path
on this site (`src/lib/returnUrl.ts`: no `//`, no backslash, no control
characters), so a crafted login link cannot bounce a user elsewhere after
signing in.

**Failed logins are deliberately vague** - "Email or password is incorrect"
rather than naming which was wrong, which would confirm that an address exists.


### Request hardening

**XSS (cross-site scripting).** Two layers. React escapes every value it
renders, and the code never uses `dangerouslySetInnerHTML`, so text a user
types is shown as text. Second, `src/middleware.ts` sends a
`Content-Security-Policy` with a fresh nonce on every request:
`script-src 'self' 'nonce-…' 'strict-dynamic'`. A script that someone manages to
inject has no nonce, so the browser refuses to run it; inline event handlers
and `javascript:` URLs are refused for the same reason. `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'` close the
other injection routes, and `unsafe-eval` exists in development only. (Checked
in a real browser: an injected inline script and an injected `onerror` handler
are both blocked, and every page loads with no policy violations.) If a new
page ever trips the policy, set `CSP_REPORT_ONLY=1` to log violations instead of
blocking while you fix it.

**Security headers** on every response (`next.config.mjs`): HSTS for two
years, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
that switches off camera, microphone, geolocation and payment.

**Route gate.** `middleware.ts` (Node.js runtime, no database call) checks the
session cookie's signature before `/dashboard`, `/bookings`, `/admin` and
`/coach` render, and the role for `/admin` and `/coach`. It is defence in depth:
`getSession()`, the pages and the services still make the real decision, using
the database.

**CSRF on the JSON API.** Every POST, PATCH and DELETE route first calls
`assertSameOrigin`: the `Origin` (or `Referer`) must match the host in
`APP_URL`, or the answer is 403. Server actions rely on Next's own origin check.

**Rate limiting** lives in Postgres (`RateLimitBucket`), one atomic
`INSERT … ON CONFLICT DO UPDATE`, so it holds across serverless instances with
no Redis. Keys are SHA-256 hashes, so no email or address is stored in plain
text. Limits: login 5 per 15 min per ip+email and 30 per 15 min per ip (a
successful login clears the ip+email bucket), register 5/h, forgot-password
3/h per ip and per email, reset-password 10/h, contact form 5/h, bookings 30
per 10 min per user, uploads 20/h per user. `RATE_LIMIT_MULTIPLIER` (1 to 20) scales every count for a busy day. If the database is down the limiter
fails open for public pages and closed for sign-in and password flows.

**Request bodies.** `readJson` rejects a non-JSON Content-Type (415), a body over
100,000 bytes (413) and invalid JSON (400) before any route logic runs.

**Errors.** `global-error.tsx` and `error.tsx` show a fixed message; the real
error is logged by `src/lib/logger.ts`. No route returns a stack trace, and
`/api/health/ready` answers `{ "status": "unavailable" }` with no detail.

---

## Accessibility

- Semantic landmarks: `header`, `nav`, `main`, `footer`, `article`, `figure`
- Skip-to-content link, visible on keyboard focus
- `:focus-visible` outline in brand red on every interactive element
- The nav overlay is a real modal: `aria-modal`, focus moved in on open, focus trapped on Tab, Escape closes, focus restored, page behind it locked from scrolling
- Every input has a `<label>`; errors use `role="alert"` and `aria-invalid`
- Timetable days are links with `role="tab"` and `aria-selected`, so the URL carries the state
- Confirmations use `role="status"`, errors `role="alert"`
- All images have `alt`; decorative ones are `alt="" aria-hidden="true"`
- `prefers-reduced-motion` disables transitions, and the scroll reveal never runs
- Scroll reveal is scoped to a `js-reveal` class added at runtime, so with JavaScript off content is visible from the first paint rather than stuck at `opacity: 0`
- Tap targets are at least 44px high, except the compact buttons in the admin tables (40px)

### Colour contrast (WCAG 2.1 AA)

| Pair | Ratio | Result |
|---|---|---|
| White on black | 21.00:1 | Pass |
| Muted `#9C9C9C` on black | 7.65:1 | Pass |
| Muted on card `#171717` | 6.53:1 | Pass |
| Brand red `#FF0000` on black | 5.25:1 | Pass |
| White on button red `#E60000` | 4.81:1 | Pass |
| Muted label `#8C8C8C` (`--mut-2`) on black | 6.25:1 | Pass |
| Muted label on card `#171717` | 5.33:1 | Pass |
| Muted label on input `#252525` | 4.56:1 | Pass |
| Error red `#FF6B6B` on card `#171717` | 6.46:1 | Pass |

Red is split in two on purpose. `--red` `#FF0000` is the brand accent for text,
borders and icons on black. `--red-btn` `#E60000` fills buttons and badges,
because white on pure `#FF0000` measures 4.00:1 and fails AA at body size. The
two are indistinguishable side by side but the button text becomes compliant.

---

## Images

The 16 files in `public/images/` come from 29 photographs supplied by the
client, cropped per slot, resized, contrast-lifted (the gym is dimly lit) and
saved as progressive JPEG at quality 80, roughly 1.7 MB in total. `next/image`
serves them in modern formats at the size each breakpoint actually needs; the
hero is marked `priority` and everything else lazy-loads.

Every photograph is of the empty facility; the client supplied no photos of
people. A coach card shows the coach's portrait when an admin has set an image
link, and otherwise a monogram built from the coach's name. Coach and event
images live in the public Blob store: an admin uploads one on the form, or
pastes an `https` link to that store, and any other link is refused.

Fonts are self-hosted through `next/font`, so there is no request to Google on
page load and no layout shift as the font swaps in.

---

## Tests

Sixteen files in `tests/` (471 checks), run in order by `npm test`. Most of them talk to a
real PostgreSQL database that the tests empty and re-seed, so `TEST_DATABASE_URL`
must name a database you do not mind losing (it must differ from `DATABASE_URL`
and `DIRECT_URL`, or the tests refuse to run). "resend" and "@vercel/blob" are
replaced by in-memory stubs, so no test sends an email or touches a real store.

```bash
# One Postgres 16 container with the two databases CI uses, then:
docker run -d --name pfc-db -e POSTGRES_PASSWORD=pfc_local -p 55432:5432 postgres:16
docker exec pfc-db psql -U postgres -c "CREATE DATABASE pfc_app" -c "CREATE DATABASE pfc_test"
export DATABASE_URL=postgresql://postgres:pfc_local@localhost:55432/pfc_app
export DIRECT_URL=$DATABASE_URL
export TEST_DATABASE_URL=postgresql://postgres:pfc_local@localhost:55432/pfc_test
npm test
```

| File | Covers |
|---|---|
| `dates`, `session`, `logic`, `config` | Johannesburg time rules, cookie signing and tampering, data and validation, redirect guard, image links, rate-limit multiplier, start-up checks |
| `api`, `fighters`, `admin`, `uploads`, `password`, `email` | Booking and cancellation routes, bout offers and results, admin and coach services, uploads and the private store, password reset, email templates and queue |
| `hostile-input`, `security`, `rate-limit-multiplier`, `seed-guard`, `seed-passwords` | Hostile input on every service, rate limiter, origin and body checks, CSP and headers, seed refusal rules and seed passwords |
| `flows` | One scripted scenario each for a guest, a new member, a member on a full class, a fighter, a coach, an admin (including the `/admin` redirect) and a hostile user |

---

## Deployment

GitHub Actions is the only thing that ships code. Vercel's own Git integration
is switched off (`vercel.json` sets `git.deploymentEnabled` to `false`), so the
pipeline described here is the pipeline that runs.

### Branches

| Branch | Purpose | Gets deployed to |
| --- | --- | --- |
| `feature/*` | One piece of work, opened as a pull request into `develop` | nothing (CI only) |
| `develop` | Integration branch | Vercel **preview**, against the Neon `dev` branch |
| `main` | Released code | Vercel **production**, against the Neon `main` branch, after a reviewer approves |

### Workflows

**`.github/workflows/ci.yml`** runs on every pull request to `develop` or
`main` and on every push to them. One job per concern, so a failure says what
broke: `lint`, `typecheck`, `build`, `test` (a throwaway `postgres:16`
container, `prisma migrate deploy`, then `npm test`; never a real Neon
database) and `audit` (`npm audit --omit=dev --audit-level=high`). A newer push
to the same ref cancels the older run.

**`.github/workflows/deploy.yml`** starts only when CI has finished
successfully for a push (`workflow_run`). For `main`: pull the production
settings, `vercel build --prod`, `prisma migrate deploy`, `vercel deploy
--prebuilt --prod`, then a smoke test that must get a 200 from
`/api/health/ready`. The job uses the `production` GitHub Environment, which
holds it until a required reviewer approves. For `develop` it does the same
against preview. Deploys never cancel each other half-way: one runs at a time
per branch and the next waits.

```mermaid
flowchart LR
    F[feature branch] --> PR[pull request]
    PR --> CI{{"CI checks<br/>lint, typecheck, build,<br/>test, audit"}}
    CI -->|all green, merge| D[develop]
    D --> CI2{{"CI on push<br/>(test gate)"}}
    CI2 --> M1[/"prisma migrate deploy<br/>(Neon dev)"/]
    M1 --> P[Vercel preview]
    P --> SM1[smoke test<br/>/api/health/ready]
    D -->|release PR, CI green, merge| MAIN[main]
    MAIN --> CI3{{"CI on push<br/>(test gate)"}}
    CI3 --> AP[/"reviewer approval<br/>(production environment)"/]
    AP --> M2[/"prisma migrate deploy<br/>(Neon main)"/]
    M2 --> PROD[Vercel production]
    PROD --> SM2[smoke test<br/>/api/health/ready]
```

### Secrets and environment variables

GitHub secrets (Settings, Secrets and variables, Actions):

| Name | Where it is set | Purpose |
| --- | --- | --- |
| `VERCEL_TOKEN` | GitHub secret | Lets the Vercel CLI pull settings, build and deploy |
| `VERCEL_ORG_ID` | GitHub secret | Vercel team or account id, from `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | GitHub secret | Vercel project id, from the same file |
| `PROD_DIRECT_URL` | GitHub secret | Neon `main` **direct** (non-pooled) string, used only by `prisma migrate deploy` in the production job |
| `PREVIEW_DIRECT_URL` | GitHub secret | Neon `dev` **direct** string, used only by `prisma migrate deploy` in the preview job |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub secret, optional | Only if Vercel Deployment Protection is on: lets the smoke test past it |

GitHub **variable** (same page, Variables tab):

| Name | Where it is set | Purpose |
| --- | --- | --- |
| `PREVIEW_ALIAS` | GitHub variable, optional | A `*.vercel.app` name (e.g. `pfc-gym-preview.vercel.app`) that the preview job points at each new preview deployment. It must equal `APP_URL` in the Preview environment, so the same-origin check keeps working. When unset, no alias is made |

The app's own variables are set in Vercel (Project, Settings, Environment
Variables), separately for Production and Preview. `.env.example` documents
each one: `SESSION_SECRET`, `DATABASE_URL` (pooled), `DIRECT_URL`, `APP_URL`,
`RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_INBOX`, `PUBLIC_BLOB_STORE_ID`,
`PRIVATE_BLOB_STORE_ID`, and optionally `CSP_REPORT_ONLY`. `TEST_DATABASE_URL`
is for local `npm test` only; CI provides its own. `APP_URL` must be the
address the browser uses, because the same-origin check on the JSON API
compares the request's `Origin` with it. Preview deployments get a new URL
each time, so set `PREVIEW_ALIAS` and use it as `APP_URL` in the Preview
environment. For SEED_* and everything else, see [docs/OPERATIONS.md](docs/OPERATIONS.md).

Nothing secret is ever echoed: the token is read from the environment by the
CLI, the bypass header goes through a file, and GitHub masks secret values in
logs.

### Seeding and the smoke test

`npm run db:seed` refuses any database that is not localhost, listed in
`SEED_ALLOWED_HOSTS` (put the Neon dev host there in `.env`) or named in
`SEED_CONFIRM_HOST`, which you set for a single command to seed production once
(the command is in docs/OPERATIONS.md). The seed prints only the host.

`npm run smoke -- <baseUrl> [--expect-seed]` checks a running deployment:
health, security headers and CSP, the sign-in redirects, the same-origin
refusal, public API shape, the reset-link headers, a clean 404 and the
http-to-https redirect. It exits 1 on any failure. Set `SMOKE_BYPASS_SECRET` if
Deployment Protection is on.

### The migration rule

Migrations run **before** the new code goes live, so for a short while the
previous release is serving traffic against the new schema. Every migration
must therefore be backward compatible with the previous release: add a column
(nullable or with a default) in one release and start using it in the next;
stop using a column in one release and drop it in the one after. Never rename
or drop something the running release still reads.

### Rolling back

Redeploy the previous Vercel deployment: in the Vercel dashboard open
Deployments, pick the last good one and choose "Promote to Production" (or run
`vercel rollback`). That restores the old code in seconds. Migrations only move
forward and are not undone, which is why the rule above matters: the old code
has to keep working on the new schema. To undo a schema change, ship a new
migration that reverses it.

