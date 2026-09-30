# PFC - Professional Fighting Championship

Next.js 15 front end for Task 2 (Code and Implementation), INSY7315 Work
Integrated Learning.

**Client:** Professional Fighting Championship, Bothasig, Cape Town
**Team:** Seth Oliver (desktop), Ruan Cupido (mobile)

---

## Running it

Requires Node 18.18 or newer.

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

```bash
npm run build && npm start   # production build
npm run typecheck            # tsc --noEmit
```

### Demo accounts

| Email | Password | Role | Lands on |
|---|---|---|---|
| `member@pfc.co.za` | `Member123!` | Member | Member dashboard, R900 plan |
| `sofia@pfc.co.za` | `Coach123!` | Coach | Coach dashboard |
| `marcus@pfc.co.za` | `Coach123!` | Coach | Coach dashboard |
| `admin@pfc.co.za` | `Admin123!` | Admin | Admin dashboard |

All three roles use the same `/dashboard` URL; the session's role picks the view.

---

## Structure

```
├── src/
│   ├── app/                     App Router — one folder per route
│   │   ├── layout.tsx           header, footer, fonts, scroll reveal
│   │   ├── page.tsx             home
│   │   ├── globals.css          all styling, mobile-first
│   │   ├── classes/ coaches/ memberships/ timetable/ contact/
│   │   ├── login/ register/ promo/ denied/
│   │   ├── dashboard/           page.tsx picks Member/Coach/Admin view
│   │   ├── error.tsx            runtime error boundary
│   │   └── not-found.tsx        404
│   ├── actions/
│   │   ├── auth.ts              login, register, logout, requireSession
│   │   └── gym.ts               booking, plan changes, contact enquiry
│   ├── components/              header/nav, footer, cards, form fields
│   └── lib/
│       ├── types.ts             domain types and formatting helpers
│       ├── gym-data.ts          seeded content — the database seam
│       ├── users.ts             accounts, scrypt password hashing
│       ├── session.ts           signed cookie sessions
│       └── validation.ts        shared form rules
└── public/images/               16 optimised photos of the client's facility
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

**Server components by default.** Pages render on the server and ship no
JavaScript for their content. Only five components opt into the client, and each
does so for a reason it could not achieve otherwise: the nav overlay (open
state and focus trap), the three forms (`useActionState` for inline errors), the
password toggle, the submit button (`useFormStatus`), and the scroll reveal.

**Server actions instead of API routes.** Forms post directly to functions
marked `"use server"`. Next generates the endpoint and includes an anti-CSRF
origin check automatically, so there is no fetch wrapper and no hand-rolled
token to get wrong.

**Validation runs on the server, always.** `lib/validation.ts` holds the rules;
every action runs them on submission and re-renders the form with per-field
errors. The client components surface those errors instantly through
`useActionState`, but the browser is never trusted, with JavaScript disabled
the form still posts, still validates, and still shows errors.

**The data layer is one seam.** Pages import from `lib/gym-data.ts` and
`lib/users.ts` and never touch storage directly. Part 2 swaps those two modules
for Prisma or Drizzle queries; no page or component changes.

**`server-only` is enforced, not assumed.** `gym-data.ts`, `users.ts` and
`session.ts` import the `server-only` package, so importing one into a client
component fails the build rather than silently shipping password hashes to the
browser.

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
on this site, so a crafted login link cannot bounce a user elsewhere after
signing in.

**Failed logins are deliberately vague** - "Email or password is incorrect"
rather than naming which was wrong, which would confirm that an address exists.

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
- Tap targets 44×44px minimum

### Colour contrast (WCAG 2.1 AA)

| Pair | Ratio | Result |
|---|---|---|
| White on black | 21.00:1 | Pass |
| Muted `#9C9C9C` on black | 7.65:1 | Pass |
| Muted on card `#171717` | 6.53:1 | Pass |
| Brand red `#FF0000` on black | 5.25:1 | Pass |
| White on button red `#E60000` | 4.81:1 | Pass |

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

Every photograph is of the empty facility, the client supplied no photos of
people. Coach cards therefore render a monogram built from the coach's name
(`initials()` in `lib/types.ts`). If portraits arrive later, add an `imagePath`
to the `Coach` type and swap the div in `CoachCard.tsx` for an `<Image>`.

Fonts are self-hosted through `next/font`, so there is no request to Google on
page load and no layout shift as the font swaps in.

---

## Tests

`npm install` first, then:

```bash
npx tsx tests/logic.test.ts     # 43 checks: data, users, validation, formatting
npx tsx tests/session.test.ts   #  9 checks: session signing and tamper resistance
```

The session suite includes the important one, forging a payload to claim a
different role is rejected, because the signature no longer matches.

---

## Still to do for Part 2

- **Database.** `gym-data.ts` and `users.ts` hold seeded arrays. Replace with Prisma or Drizzle plus migrations. Until then, bookings and new registrations survive navigation but reset when the server restarts.
- **Booking concurrency.** `bookSlot` checks capacity then increments. Two simultaneous bookings for the last place could both succeed; the database version must re-check inside a transaction.
- **Contact form** logs and discards. Needs persistence plus an email send.
- **Attendance and billing figures** on the member dashboard are placeholders.
- **Admin CRUD** — the dashboard lists users and classes but cannot edit them.
- **Route middleware.** Pages guard themselves with `requireSession`, which is the authoritative check. A `middleware.ts` would add defence in depth, but the session HMAC uses `node:crypto`, so it needs the Node middleware runtime rather than Edge.
- **Hosting and CI/CD.** Vercel or Azure Static Web Apps, plus a GitHub Actions workflow that builds, typechecks and runs the tests.
