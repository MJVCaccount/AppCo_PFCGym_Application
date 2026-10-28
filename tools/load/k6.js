// k6 load test: 50 virtual users for 2 minutes against a LOCAL production build.
//
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3100 -e ORIGIN=https://host.docker.internal:3100 \
//     grafana/k6 run - < tools/load/k6.js
//
// What each virtual user does, in a loop with a short pause:
//   70%  browse: a public page, then a public JSON route
//   10%  sign in: the sign-in form, the way a browser without JavaScript posts it
//   20%  book: sign in once, book a class, read "my bookings", cancel it
//
// Thresholds: p95 of every request under 500 ms and under 1% errors. A 409 from
// a full class is an expected answer, not an error. Run it ONLY against a local
// build (APP_URL set to the ORIGIN above, RATE_LIMIT_MULTIPLIER=20, a throwaway
// database seeded by tools/load/seed-load-users.ts).
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://host.docker.internal:3100";
const ORIGIN = __ENV.ORIGIN || "https://host.docker.internal:3100";
const PASSWORD = "Load-Test-Password-1!";
const COOKIE_NAME = "__Host-pfc_session";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

export const options = {
  scenarios: {
    people: { executor: "constant-vus", vus: 50, duration: "2m" },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    unexpected_status: ["rate<0.01"],
    // Reporting only: a generous ceiling per kind of request, so the summary shows each separately.
    "http_req_duration{name:GET page}": ["p(95)<1000"],
    "http_req_duration{name:GET api}": ["p(95)<1000"],
    "http_req_duration{name:POST /login}": ["p(95)<2000"],
    "http_req_duration{name:POST /api/bookings}": ["p(95)<1000"],
    "http_req_duration{name:GET /api/bookings}": ["p(95)<1000"],
    "http_req_duration{name:POST /api/bookings/:id/cancel}": ["p(95)<1000"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const unexpected = new Rate("unexpected_status");
const logins = new Counter("sign_ins");
const bookings = new Counter("bookings_made");
const full = new Counter("bookings_refused_full");

const PAGES = ["/", "/classes", "/timetable", "/coaches", "/memberships", "/events", "/contact"];
const APIS = ["/api/classes", "/api/timetable", "/api/events", "/api/health/ready"];

export function setup() {
  const slots = JSON.parse(http.get(`${BASE}/api/timetable`).body).data;
  return { slotIds: slots.map((s) => s.id) };
}

const sessions = {}; // one cookie per virtual user, kept between iterations

function hiddenFields(html) {
  const fields = [];
  const tags = html.match(/<input[^>]*type="hidden"[^>]*>/g) || [];
  for (const tag of tags) {
    const name = /name="([^"]*)"/.exec(tag);
    const value = /value="([^"]*)"/.exec(tag);
    if (name) fields.push([name[1], (value ? value[1] : "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")]);
  }
  return fields;
}

function multipart(fields) {
  const boundary = "----k6boundary" + Math.random().toString(16).slice(2);
  let body = "";
  for (const [name, value] of fields) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  return { body: body + `--${boundary}--\r\n`, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Signs in through the real form and returns the session cookie value, or null. */
function signIn(email) {
  const page = http.get(`${BASE}/login`);
  const form = multipart([...hiddenFields(page.body), ["email", email], ["password", PASSWORD]]);
  const res = http.post(`${BASE}/login`, form.body, {
    headers: { "Content-Type": form.contentType, Origin: ORIGIN },
    redirects: 0,
    tags: { name: "POST /login" },
  });

  const cookie = /__Host-pfc_session=([^;]+)/.exec(String(res.headers["Set-Cookie"] || ""));
  const ok = check(res, { "sign-in redirects with a session": () => !!cookie && res.status >= 300 && res.status < 400 });
  unexpected.add(!ok);
  if (ok) logins.add(1);
  return cookie ? cookie[1] : null;
}

const jsonHeaders = (cookie) => ({
  "Content-Type": "application/json",
  Origin: ORIGIN,
  Cookie: `${COOKIE_NAME}=${cookie}`,
});

export default function (data) {
  const email = `load${String(__VU).padStart(2, "0")}@load.pfc.test`;
  const roll = Math.random();

  if (roll < 0.7) {
    const page = http.get(`${BASE}${PAGES[Math.floor(Math.random() * PAGES.length)]}`, { tags: { name: "GET page" } });
    unexpected.add(!check(page, { "page is 200": (r) => r.status === 200 }));
    const api = http.get(`${BASE}${APIS[Math.floor(Math.random() * APIS.length)]}`, { tags: { name: "GET api" } });
    unexpected.add(!check(api, { "api is 200": (r) => r.status === 200 }));
  } else if (roll < 0.8) {
    sessions[__VU] = signIn(email) || sessions[__VU];
  } else {
    if (!sessions[__VU]) sessions[__VU] = signIn(email);
    const cookie = sessions[__VU];
    if (cookie) {
      const slotId = data.slotIds[Math.floor(Math.random() * data.slotIds.length)];
      const book = http.post(`${BASE}/api/bookings`, JSON.stringify({ slotId }), { headers: jsonHeaders(cookie), tags: { name: "POST /api/bookings" } });
      // 201 booked; 409 full or already booked; 403 means no plan; anything else is wrong
      unexpected.add(!check(book, { "booking is 201 or 409": (r) => r.status === 201 || r.status === 409 }));

      const mine = http.get(`${BASE}/api/bookings`, { headers: jsonHeaders(cookie), tags: { name: "GET /api/bookings" } });
      unexpected.add(!check(mine, { "my bookings is 200": (r) => r.status === 200 }));

      if (book.status === 201) {
        bookings.add(1);
        const id = JSON.parse(mine.body).data.upcoming.map((b) => b.id).sort((a, b) => b - a)[0];
        if (id) {
          const cancel = http.post(`${BASE}/api/bookings/${id}/cancel`, null, { headers: jsonHeaders(cookie), tags: { name: "POST /api/bookings/:id/cancel" } });
          unexpected.add(!check(cancel, { "cancel is 200 or 409": (r) => r.status === 200 || r.status === 409 }));
        }
      } else if (book.status === 409) {
        full.add(1);
      }
    }
  }

  sleep(0.5 + Math.random());
}
