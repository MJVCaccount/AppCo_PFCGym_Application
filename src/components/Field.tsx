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

// Re-exported so the long-standing `import Field, { fieldIds } from "./Field"`
// keeps working; the scheme itself lives in lib/field-ids.ts.
import type { FieldIds } from "@/lib/field-ids";

export { fieldIds, type FieldIds } from "@/lib/field-ids";

interface Props {
  ids: FieldIds;
  label: string;
  /** Short guidance under the label, e.g. "PDF, JPEG or PNG, up to 4 MB". */
  hint?: string;
  error?: string;
  full?: boolean;
  /**
   * Set where the hint CHANGES while the field is in use — a chosen file name,
   * an upload progress message — so the new text is announced. Left off for a
   * static hint, which would otherwise make moving between pages chatty.
   */
  liveHint?: boolean;
  children: React.ReactNode;
  /** Rendered below the error slot, e.g. a "Forgot password?" link. */
  footer?: React.ReactNode;
}

export default function Field({
  ids,
  label,
  hint,
  error,
  full = false,
  liveHint = false,
  children,
  footer,
}: Props) {
  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label htmlFor={ids.control}>{label}</label>

      {/* Rendered unconditionally so the id referenced above always resolves.
          The role is fixed for the node's lifetime rather than flipped between
          "status" and "alert" as the message changes: a live region is
          registered when the node enters the tree, so a role swapped on a node
          already in the document is not reliably honoured. */}
      <span className="field__hint" id={ids.hint} role={liveHint ? "status" : undefined}>
        {hint ?? ""}
      </span>

      {children}

      <span className="error" id={ids.error} role="alert">
        {error ?? ""}
      </span>

      {footer}
    </div>
  );
}
