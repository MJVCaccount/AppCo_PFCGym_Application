/**
 * The id scheme every form control on the site shares.
 *
 * It lives in lib rather than beside the Field component because it is a pure
 * function with no JSX: that keeps it importable from the test suite, from a
 * server component and from a client component alike, and keeps the naming
 * rule in one place rather than spelled out at each call site.
 */

export interface FieldIds {
  control: string;
  hint: string;
  error: string;
  /** Ready to put on the input, select or textarea. */
  describedBy: string;
}

/**
 * @param name  The control's form name, which is also its id by convention.
 * @param scope Required where the SAME form renders more than once on a page —
 *   /admin/classes renders four copies of a ten-field form. Without it every
 *   copy claims the same ids, and because a browser resolves `htmlFor` and
 *   `aria-describedby` to the FIRST matching element, all four labels and all
 *   four error messages point at the first form's inputs. Omitted elsewhere, so
 *   single-instance forms keep the plain `f-<name>` ids already in use.
 */
export function fieldIds(name: string, scope?: string): FieldIds {
  const control = scope ? `f-${scope}-${name}` : `f-${name}`;
  const hint = `${control}-hint`;
  const error = `${control}-error`;

  // Both are always referenced; either may be empty at any moment.
  return { control, hint, error, describedBy: `${hint} ${error}` };
}
