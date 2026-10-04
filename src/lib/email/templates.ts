import "server-only";

import { formatEventDate, formatSessionDate } from "@/lib/dates";
import { appUrl } from "@/lib/env";

/**
 * The text of every email the app sends.
 *
 * Each function returns { subject, html, text }. Every value that came from a
 * person or the database goes through escapeHtml before it reaches the HTML,
 * and the plain-text part is always present. There are no remote images and
 * no tracking pixels; links are built from APP_URL only.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A subject is one line: a pasted newline would otherwise add mail headers. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 150);
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

const GYM = "Professional Fighting Championship";

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;line-height:1.5">${html}</p>`;
}

function button(url: string, label: string): string {
  const href = escapeHtml(url);
  return (
    `<p style="margin:24px 0"><a href="${href}" ` +
    `style="background:#c8102e;color:#ffffff;padding:12px 20px;` +
    `text-decoration:none;font-weight:bold;border-radius:4px;display:inline-block">` +
    `${escapeHtml(label)}</a></p>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#555555">` +
    `If the button does not work, copy this link into your browser:<br>${href}</p>`
  );
}

/** Rows of "label: value" for the HTML part. */
function facts(rows: [string, string][]): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#555555">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0"><b>${escapeHtml(value)}</b></td></tr>`,
    )
    .join("");
  return `<table role="presentation" style="margin:0 0 16px;border-collapse:collapse">${body}</table>`;
}

function textFacts(rows: [string, string][]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function wrap(heading: string, bodyHtml: string): string {
  return (
    `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f4f4f4;` +
    `font-family:Arial,Helvetica,sans-serif;color:#111111">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:6px">` +
    `<h1 style="margin:0 0 20px;font-size:22px">${escapeHtml(heading)}</h1>` +
    bodyHtml +
    `<p style="margin:24px 0 0;font-size:13px;color:#555555">${escapeHtml(GYM)}</p>` +
    `</div></body></html>`
  );
}

function sign(text: string): string {
  return `${text}\n\n${GYM}`;
}

// ---------------------------------------------------------------- accounts

export function welcome(input: { fullName: string }): EmailContent {
  const name = firstName(input.fullName);
  const timetable = `${appUrl()}/timetable`;

  return {
    subject: "Welcome to PFC",
    html: wrap(
      `Welcome to PFC, ${name}`,
      paragraph("Your account is ready. You can book classes from the timetable.") +
        button(timetable, "See the timetable"),
    ),
    text: sign(
      `Welcome to PFC, ${name}.\n\nYour account is ready. You can book classes from the timetable:\n${timetable}`,
    ),
  };
}

export function passwordReset(input: {
  fullName: string;
  token: string;
  minutesValid: number;
}): EmailContent {
  const name = firstName(input.fullName);
  const link = `${appUrl()}/reset-password/${encodeURIComponent(input.token)}`;
  const minutes = String(input.minutesValid);

  return {
    subject: "Reset your PFC password",
    html: wrap(
      "Reset your password",
      paragraph(`Hi ${escapeHtml(name)}, we received a request to reset your password.`) +
        button(link, "Choose a new password") +
        paragraph(
          `The link works once and expires in ${escapeHtml(minutes)} minutes. ` +
            "If you did not ask for this, you can ignore this email; your password has not changed.",
        ),
    ),
    text: sign(
      `Hi ${name},\n\nWe received a request to reset your password. Choose a new one here:\n${link}\n\n` +
        `The link works once and expires in ${minutes} minutes. If you did not ask for this, ` +
        "ignore this email; your password has not changed.",
    ),
  };
}

export function coachInvite(input: {
  fullName: string;
  token: string;
  daysValid: number;
}): EmailContent {
  const name = firstName(input.fullName);
  const link = `${appUrl()}/reset-password/${encodeURIComponent(input.token)}`;
  const days = String(input.daysValid);

  return {
    subject: "You have been invited to PFC",
    html: wrap(
      `Welcome to the PFC team, ${name}`,
      paragraph("A coach account has been created for you. Set your password to sign in.") +
        button(link, "Set your password") +
        paragraph(`The link works once and expires in ${escapeHtml(days)} days.`),
    ),
    text: sign(
      `Hi ${name},\n\nA coach account has been created for you. Set your password here:\n${link}\n\n` +
        `The link works once and expires in ${days} days.`,
    ),
  };
}

// ---------------------------------------------------------------- bookings

export interface BookingDetails {
  fullName: string;
  className: string;
  coachName: string;
  /** Weekday name, e.g. "Monday". */
  dayName: string;
  /** 24-hour "HH:mm". */
  startsAt: string;
  /** ISO date, "YYYY-MM-DD", the session's date on the gym's calendar. */
  sessionDate: string;
}

export function bookingConfirmed(input: BookingDetails): EmailContent {
  const name = firstName(input.fullName);
  const when = formatSessionDate(input.sessionDate);
  const rows: [string, string][] = [
    ["Class", input.className],
    ["Coach", input.coachName],
    ["Day", `${input.dayName} ${when}`],
    ["Time", `${input.startsAt} (Johannesburg time)`],
  ];

  return {
    subject: oneLine(`Booked: ${input.className} on ${when}`),
    html: wrap(
      "Your class is booked",
      paragraph(`Hi ${escapeHtml(name)}, your place is confirmed.`) +
        facts(rows) +
        paragraph("You can cancel from My bookings until the class starts."),
    ),
    text: sign(
      `Hi ${name}, your place is confirmed.\n\n${textFacts(rows)}\n\nYou can cancel from My bookings until the class starts.`,
    ),
  };
}

export function bookingCancelledByGym(
  input: Omit<BookingDetails, "coachName">,
): EmailContent {
  const name = firstName(input.fullName);
  const when = formatSessionDate(input.sessionDate);
  const rows: [string, string][] = [
    ["Class", input.className],
    ["Day", `${input.dayName} ${when}`],
    ["Time", `${input.startsAt} (Johannesburg time)`],
  ];

  return {
    subject: oneLine(`Cancelled: ${input.className} on ${when}`),
    html: wrap(
      "Your class has been cancelled",
      paragraph(
        `Hi ${escapeHtml(name)}, we are sorry: the gym has cancelled this class and your booking with it.`,
      ) +
        facts(rows) +
        paragraph("Please pick another class from the timetable."),
    ),
    text: sign(
      `Hi ${name}, we are sorry: the gym has cancelled this class and your booking with it.\n\n${textFacts(rows)}\n\nPlease pick another class from the timetable.`,
    ),
  };
}

// ---------------------------------------------------------------- enquiries

export function enquiryReceivedAutoReply(input: {
  fullName: string;
}): EmailContent {
  const name = firstName(input.fullName);

  return {
    subject: "We received your message",
    html: wrap(
      "Thanks for getting in touch",
      paragraph(
        `Hi ${escapeHtml(name)}, we received your message and usually reply within one working day.`,
      ),
    ),
    text: sign(
      `Hi ${name}, we received your message and usually reply within one working day.`,
    ),
  };
}

export function enquiryToGym(input: {
  fullName: string;
  email: string;
  phone: string | null;
  message: string;
}): EmailContent {
  const rows: [string, string][] = [
    ["Name", input.fullName],
    ["Email", input.email],
    ["Phone", input.phone ?? "not given"],
  ];

  return {
    subject: oneLine(`Website enquiry from ${input.fullName}`),
    html: wrap(
      "New website enquiry",
      facts(rows) +
        `<p style="margin:0 0 16px;line-height:1.5;white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
    ),
    text: `${textFacts(rows)}\n\n${input.message}`,
  };
}

// ---------------------------------------------------------------- fighters

export function boutOffered(input: {
  fullName: string;
  eventName: string;
  /** ISO-8601 UTC instant. */
  eventDate: string;
  venue: string;
  opponentName: string | null;
  boutWeightClass: string | null;
}): EmailContent {
  const name = firstName(input.fullName);
  const dashboard = `${appUrl()}/dashboard`;
  const rows: [string, string][] = [
    ["Event", input.eventName],
    ["When", formatEventDate(input.eventDate)],
    ["Venue", input.venue],
    ["Opponent", input.opponentName ?? "To be confirmed"],
    ["Weight class", input.boutWeightClass ?? "To be confirmed"],
  ];

  return {
    subject: oneLine(`Bout offer: ${input.eventName}`),
    html: wrap(
      "You have a bout offer",
      paragraph(`Hi ${escapeHtml(name)}, you have been offered a bout.`) +
        facts(rows) +
        button(dashboard, "Accept or decline"),
    ),
    text: sign(
      `Hi ${name}, you have been offered a bout.\n\n${textFacts(rows)}\n\nAccept or decline here:\n${dashboard}`,
    ),
  };
}

export function eventCancelled(input: {
  fullName: string;
  eventName: string;
  /** ISO-8601 UTC instant. */
  eventDate: string;
}): EmailContent {
  const name = firstName(input.fullName);
  const when = formatEventDate(input.eventDate);

  return {
    subject: oneLine(`Event cancelled: ${input.eventName}`),
    html: wrap(
      "An event has been cancelled",
      paragraph(
        `Hi ${escapeHtml(name)}, ${escapeHtml(input.eventName)} on ${escapeHtml(when)} has been cancelled, ` +
          "so your bout offer no longer applies.",
      ),
    ),
    text: sign(
      `Hi ${name}, ${input.eventName} on ${when} has been cancelled, so your bout offer no longer applies.`,
    ),
  };
}

export function documentReviewed(input: {
  fullName: string;
  documentType: string;
  status: "Approved" | "Rejected";
  note: string | null;
}): EmailContent {
  const name = firstName(input.fullName);
  const verdict = input.status.toLowerCase();
  const dashboard = `${appUrl()}/dashboard`;

  return {
    subject: oneLine(`Your ${input.documentType} document was ${verdict}`),
    html: wrap(
      `Your document was ${verdict}`,
      paragraph(
        `Hi ${escapeHtml(name)}, your ${escapeHtml(input.documentType)} document was ${escapeHtml(verdict)}.`,
      ) +
        (input.note
          ? paragraph(`Note from the gym: ${escapeHtml(input.note)}`)
          : "") +
        button(dashboard, "Open your dashboard"),
    ),
    text: sign(
      `Hi ${name}, your ${input.documentType} document was ${verdict}.` +
        (input.note ? `\n\nNote from the gym: ${input.note}` : "") +
        `\n\n${dashboard}`,
    ),
  };
}
