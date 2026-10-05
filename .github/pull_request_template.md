## What changed and why

<!-- One or two sentences. Link the task or issue. -->

## Checklist

- [ ] Tests added or updated for every behaviour change (`tests/`)
- [ ] No `console.*` statements in `src/` (use `src/lib/logger.ts`)
- [ ] Any new environment variable is documented in `.env.example` with a comment
- [ ] Any migration is backward compatible with the previous release (add columns before using them; remove them one release later)
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass locally

## Manual test steps

<!-- How a reviewer can see it working, e.g. "Sign in as admin@pfc.co.za, open /admin/events, create an event". -->

1.
2.
3.
