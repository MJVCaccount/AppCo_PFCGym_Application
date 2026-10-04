/**
 * Text normalisation for form and JSON input.
 *
 * Input arrives as `unknown`: a missing FormData key is null, a missing JSON
 * property is undefined, and an untouched text box is "". These helpers give
 * every caller the same answer for all three.
 */

/** Trimmed text, or null when the value is null, undefined, blank or not text. */
export function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Trimmed text whose length is within `min`..`max` inclusive, or null when it
 * is missing or outside that range.
 */
export function requiredText(
  value: unknown,
  min: number,
  max: number,
): string | null {
  const text = optionalText(value);
  if (text === null) return null;

  return text.length >= min && text.length <= max ? text : null;
}
