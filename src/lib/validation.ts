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

function lengthBetween(value: string, min: number, max: number): boolean {
  const length = value.trim().length;
  return length >= min && length <= max;
}

export const RULES = {
  name(value: string): string | null {
    return value.trim().length >= 2 ? null : "Please enter your full name.";
  },

  email(value: string): string | null {
    return EMAIL_PATTERN.test(value.trim())
      ? null
      : "Enter a valid email address, e.g. you@example.co.za";
  },

  /** Optional: blank passes. */
  phone(value: string): string | null {
    if (value.trim() === "") return null;
    return PHONE_PATTERN.test(value.trim())
      ? null
      : "Enter a valid phone number, or leave it blank.";
  },

  password(value: string): string | null {
    return value.length >= 8
      ? null
      : "Password must be at least 8 characters.";
  },

  message(value: string): string | null {
    return value.trim().length >= 10
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
} as const;

export type RuleName = keyof typeof RULES;

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
