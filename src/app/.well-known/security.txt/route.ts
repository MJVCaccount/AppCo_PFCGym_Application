import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /.well-known/security.txt (RFC 9116): where to report a vulnerability.
 *
 * The contact is SECURITY_CONTACT, else the contact-form inbox, so no address
 * is written into the code. With neither set there is nothing honest to
 * publish and the answer is 404. `Expires` is always a year ahead, so the file
 * never goes stale while the app is running.
 */
export function GET(): Response {
  const contact = (
    process.env.SECURITY_CONTACT ??
    process.env.CONTACT_INBOX ??
    ""
  ).trim();

  if (!contact) return new Response("Not found", { status: 404 });

  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  expires.setUTCMilliseconds(0);

  let canonical = "";
  try {
    canonical = `Canonical: ${new URL("/.well-known/security.txt", appUrl()).href}\n`;
  } catch {
    // No usable APP_URL: leave the optional field out.
  }

  const target = /^(https?:|mailto:)/i.test(contact) ? contact : `mailto:${contact}`;
  const body =
    `Contact: ${target}\n` +
    `Expires: ${expires.toISOString()}\n` +
    `Preferred-Languages: en\n` +
    canonical;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
