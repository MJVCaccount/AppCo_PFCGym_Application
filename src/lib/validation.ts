/**
 * Form validation rules, shared by the server actions and the client-side
 * enhancement script.
 *
 * Server actions run these on every submission regardless of what the browser
 * did, so disabling JavaScript costs the instant feedback but never the
 * validation itself.
 */

export type FieldErrors = Record<string, string>;

export interface FormState {
  ok: boolean;
  /** Shown once at the top of the form. */
  message?: string;
  errors?: FieldErrors;
  /** Echoed back so the user does not retype everything after a failure. */
  values?: Record<string, string>;
}

export const EMPTY_FORM_STATE: FormState = { ok: false };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[+\d][\d\s()-]{8,}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_URL_LENGTH = 2048;

export const MAX_NAME = 100;
export const MAX_EMAIL = 254;
export const MAX_PHONE = 30;
export const MAX_MESSAGE = 2000;
export const MAX_PASSWORD = 128;

function lengthBetween(value: string, min: number, max: number): boolean {
  const length = value.trim().length;
  return length >= min && length <= max;
}

export const RULES = {
  name(value: string): string | null {
    const length = value.trim().length;
    if (length > MAX_NAME) return `Name must be at most ${MAX_NAME} characters.`;
    return length >= 2 ? null : "Please enter your full name.";
  },

  email(value: string): string | null {
    if (value.trim().length > MAX_EMAIL) return "That email address is too long.";
    return EMAIL_PATTERN.test(value.trim())
      ? null
      : "Enter a valid email address, e.g. you@example.co.za";
  },

  /** Optional: blank passes. */
  phone(value: string): string | null {
    if (value.trim() === "") return null;
    if (value.trim().length > MAX_PHONE) return "That phone number is too long.";
    return PHONE_PATTERN.test(value.trim())
      ? null
      : "Enter a valid phone number, or leave it blank.";
  },

  password(value: string): string | null {
    // The ceiling matters: scrypt on an enormous string is a way to tie the
    // server up.
    if (value.length > MAX_PASSWORD) {
      return `Password must be at most ${MAX_PASSWORD} characters.`;
    }
    return value.length >= 8
      ? null
      : "Password must be at least 8 characters.";
  },

  message(value: string): string | null {
    const length = value.trim().length;
    if (length > MAX_MESSAGE) {
      return `Message must be at most ${MAX_MESSAGE} characters.`;
    }
    return length >= 10
      ? null
      : "Tell us a little more — at least 10 characters.";
  },

  weightClass(value: string): string | null {
    return lengthBetween(value, 2, 40)
      ? null
      : "Weight class must be 2 to 40 characters.";
  },

  eventName(value: string): string | null {
    return lengthBetween(value, 3, 120)
      ? null
      : "Event name must be 3 to 120 characters.";
  },

  venue(value: string): string | null {
    return lengthBetween(value, 2, 120)
      ? null
      : "Venue must be 2 to 120 characters.";
  },

  eventDescription(value: string): string | null {
    return lengthBetween(value, 10, 2000)
      ? null
      : "Description must be 10 to 2000 characters.";
  },

  /**
   * Builds a rule for text of `min` to `max` characters once trimmed. The
   * value is `unknown` because it may come from JSON: anything that is not
   * text (a number, an array) fails rather than being read as "".
   */
  text(min: number, max: number, label = "This field") {
    return (value: unknown): string | null => {
      if (typeof value === "string" && (value.includes("\u0000") || !value.isWellFormed())) {
        return `${label} contains characters that cannot be saved.`;
      }

      return typeof value === "string" && lengthBetween(value, min, max)
        ? null
        : `${label} must be ${min} to ${max} characters.`;
    };
  },

  /** Builds a rule for a whole number from `min` to `max` inclusive. */
  integerRange(min: number, max: number, label = "This value") {
    return (value: unknown): string | null =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max
        ? null
        : `${label} must be a whole number from ${min} to ${max}.`;
  },

  /** 24-hour "HH:mm", 00:00 to 23:59. */
  timeOfDay(value: string): string | null {
    return TIME_PATTERN.test(value)
      ? null
      : "Enter a time as HH:mm, from 00:00 to 23:59.";
  },

  /** Optional: blank passes. Otherwise an https link. */
  url(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    const message = "Enter an https:// link, or leave it blank.";
    if (trimmed.length > MAX_URL_LENGTH) return message;

    try {
      return new URL(trimmed).protocol === "https:" ? null : message;
    } catch {
      return message;
    }
  },
} as const;

/** The rules that take a value directly; `text` and `integerRange` build one. */
export type RuleName = Exclude<keyof typeof RULES, "text" | "integerRange">;

/** Runs the named rule over each field and collects the failures. */
export function validate(
  data: FormData,
  fields: Record<string, RuleName>,
): FieldErrors {
  const errors: FieldErrors = {};

  for (const [field, rule] of Object.entries(fields)) {
    const value = String(data.get(field) ?? "");
    const error = RULES[rule](value);
    if (error) errors[field] = error;
  }

  return errors;
}

/** Pulls submitted values back out so the form can re-render with them. */
export function valuesFrom(
  data: FormData,
  fields: string[],
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of fields) {
    values[field] = String(data.get(field) ?? "");
  }

  return values;
}
