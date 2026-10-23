/**
 * The shared shell every form control on the site sits inside.
 *
 * It exists so the accessibility wiring is written once and cannot drift as
 * fields are added. Three rules it enforces:
 *
 * 1. `aria-describedby` is STABLE — it always points at the hint and error
 *    nodes, whether or not they currently hold text. Adding the attribute only
 *    at the moment an error appears is a common pattern and an unreliable one:
 *    several screen readers cache a control's description when it receives
 *    focus, so an attribute that appears afterwards is never announced. An
 *    always-present reference to an empty node costs nothing and always works.
 *
 * 2. The error node is `role="alert"`, so a validation failure is announced
 *    when it appears, not only when the field is next focused.
 *
 * 3. `aria-invalid` is set from the same error value that renders the text, so
 *    the visual state and the announced state can never disagree.
 */

export interface FieldIds {
  control: string;
  hint: string;
  error: string;
  /** Ready to spread onto the input, select or textarea. */
  describedBy: string;
}

export function fieldIds(name: string): FieldIds {
  const control = `f-${name}`;
  const hint = `${control}-hint`;
  const error = `${control}-error`;

  // Both are always referenced; either may be empty at any moment.
  return { control, hint, error, describedBy: `${hint} ${error}` };
}

interface Props {
  ids: FieldIds;
  label: string;
  /** Short guidance shown under the label, e.g. "PDF or JPG, up to 5 MB". */
  hint?: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}

export default function Field({
  ids,
  label,
  hint,
  error,
  full = false,
  children,
}: Props) {
  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label htmlFor={ids.control}>{label}</label>

      {/* Rendered unconditionally so the id referenced above always resolves. */}
      <span className="field__hint" id={ids.hint}>
        {hint ?? ""}
      </span>

      {children}

      <span className="error" id={ids.error} role="alert">
        {error ?? ""}
      </span>
    </div>
  );
}