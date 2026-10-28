# Load test

Run on 2026-10-28 (Cape Town). **These numbers are local and relative.** They were measured on one Windows 11 desktop (Intel Core i5-8400, 6 cores, 32 GB) where the server, the database and the load generator all ran at the same time, over the loopback network, with no TLS, no CDN and no Neon. They show that nothing in the application falls over or slows sharply at this load, and they let two runs be compared. They say nothing about how the deployed site on Vercel and Neon will perform: Vercel runs the app as separate serverless functions, Neon adds a network hop to every query and wakes from idle, and real visitors are far from uniform.

## Setup

| | |
| --- | --- |
| Application | Production build (`next build`, then `next start`), Node 24.19.0, one process |
| Database | Throwaway PostgreSQL 16 in Docker on the same machine, seeded, plus 60 load members (`tools/load/seed-load-users.ts`) |
| Environment | `APP_URL=https://host.docker.internal:3100` (so the same-origin check passes), `RATE_LIMIT_MULTIPLIER=20`, email not configured |
| Tool | k6 v2.3.0 (`grafana/k6` in Docker), `tools/load/k6.js` |
| Load | 50 virtual users for 2 minutes, each looping with a 0.5 to 1.5 s pause |
| Mix per loop | 70% browse a public page and a public JSON route; 10% sign in through the real form; 20% book a random class, read "my bookings", cancel the booking |
| Pages | `/`, `/classes`, `/timetable`, `/coaches`, `/memberships`, `/events`, `/contact` |
| Thresholds | p95 of all requests under 500 ms; failed requests under 1%; unexpected answers under 1% (a 409 from a full class is an expected answer) |

## Result: all thresholds passed

| | Value |
| --- | ---: |
| Requests | 11,811 (97 per second) |
| Loops completed | 5,359 |
| Failed requests (k6 `http_req_failed`) | 0.00% |
| Unexpected answers | 0.00% of 11,290 checks |
| Sign-ins that produced a session | 520 of 520 |
| Bookings made, then cancelled | 1,028 |
| Bookings refused because the class was full (409) | 51 |
| **p95, all requests** | **163.5 ms** (limit 500 ms) |
| Median / p90 / p99 / slowest | 37.7 / 122.6 / 362.7 / 962 ms |

| Request | Median | p95 | p99 |
| --- | ---: | ---: | ---: |
| `GET` public page | 41.1 ms | 160.4 ms | 418.2 ms |
| `GET` public JSON route | 20.7 ms | 85.1 ms | 181.3 ms |
| `POST /login` (a full scrypt check, the form posted as a browser would) | 93.9 ms | 221.2 ms | 795.7 ms |
| `POST /api/bookings` | 91.8 ms | 254.0 ms | 399.7 ms |
| `GET /api/bookings` | 31.5 ms | 92.1 ms | 128.2 ms |
| `POST /api/bookings/:id/cancel` | 57.8 ms | 165.2 ms | 226.3 ms |

During the run the server logged no 5xx. Every API answer was a 200, a 201 or a 409. The `Slow query` warning added with the health and monitoring work fired five times across the three runs (501 to 511 ms), all within one second of the second run starting, when 50 users arrived together; it did not fire in the first or the third run.

## Three runs, and why one failed

1. First run: p95 191.3 ms, 5,264 loops, all thresholds passed.
2. Second run straight after it: **the unexpected-answer threshold failed** (6.7%), because 758 of 801 sign-ins were refused. That is the sign-in limit working, not a fault: all virtual users share the load generator's one address, the limit is 30 sign-ins per 15 minutes per address (600 with the multiplier at 20), and the first run had already used 557 of them. The refusals carried `Retry-After`; no other request was affected.
3. The numbers above are the third run, after clearing the limiter's table, with the same script.

Run it again at least 15 minutes after a previous run, or clear `RateLimitBucket` on the throwaway database first.

## What this does not show

* **Neon and Vercel.** Each request on Vercel runs in a function that may start cold, and each query crosses a network to Neon, whose free compute scales to zero. Expect the slowest requests to be noticeably slower there, especially the first after quiet.
* **A real crowd.** 50 users with 1-second pauses is a steady stream, not a spike when a class opens for booking. The booking race itself is covered by `tests/booking-concurrency.test.ts`.
* **Email.** It was not configured, so booking confirmations were skipped, not sent. The outbox adds one insert per booking and a send after the response.
* **Longer than 2 minutes.** Memory growth, connection pool exhaustion over hours and the rate-limit table's growth are not tested here (the daily maintenance job deletes expired counters).
* **The limits.** With `RATE_LIMIT_MULTIPLIER=20` the limits are 20 times looser than in production, so this run does not measure the cost of being refused.

## Reproduce

```bash
# a local production build and a throwaway database (see README "Tests")
APP_URL=https://host.docker.internal:3100 npm run build
DATABASE_URL=<local database> npx prisma migrate deploy && npx prisma db seed
DATABASE_URL=<local database> npx tsx tools/load/seed-load-users.ts 60
APP_URL=https://host.docker.internal:3100 RATE_LIMIT_MULTIPLIER=20 SESSION_SECRET=<32+ chars> DATABASE_URL=<local database> npx next start -p 3100

docker run --rm -i --add-host=host.docker.internal:host-gateway \
  -e BASE_URL=http://host.docker.internal:3100 -e ORIGIN=https://host.docker.internal:3100 \
  grafana/k6 run -q - < tools/load/k6.js
```

The k6 script and the seed script refuse nothing by themselves, so point them only at a local build. The seed script does refuse any database that is not on localhost.
