import { fieldIds } from "./Field";

interface Props {
  name: string;
  /** The checkbox's own label, read out with it, e.g. "Most popular plan". */
  label: string;
  /** Optional heading above the row, e.g. "Highlight". Not a second label. */
  legend?: string;
  defaultChecked?: boolean;
  hint?: string;
  error?: string;
  full?: boolean;
  /** Set where the same form renders twice on a page; see fieldIds. */
  scope?: string;
}

/**
 * A checkbox on the same describedBy contract as every other control.
 *
 * It does not sit inside Field, because Field renders the label before the
 * control and a checkbox's label belongs after it. The two had been stacked:
 * a `<label htmlFor>` reading "Highlight" and a second wrapping label reading
 * "Most popular plan", both pointing at the same input. When more than one
 * label references a control the accessible name is all of them joined, so it
 * announced as "Highlight Most popular plan". The heading is now a plain span,
 * leaving one label and one name.
 */
export default function CheckField({
  name,
  label,
  legend,
  defaultChecked = false,
  hint,
  error,
  full = false,
  scope,
}: Props) {
  const ids = fieldIds(name, scope);

  return (
    <div className={`field${full ? " field--full" : ""}`}>
      {legend && <span className="field__legend">{legend}</span>}

      {/* Always rendered, so the id in aria-describedby always resolves. */}
      <span className="field__hint" id={ids.hint}>
        {hint ?? ""}
      </span>

      <label className="check" htmlFor={ids.control}>
        <input
          // React 19 resets a form after its action runs, and a checkbox's
          // default is only read on mount: keying on it remounts the input with
          // the value echoed back, so a tick survives a failed submit.
          key={String(defaultChecked)}
          id={ids.control}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-describedby={ids.describedBy}
          aria-invalid={error ? "true" : "false"}
        />
        {label}
      </label>

      <span className="error" id={ids.error} role="alert">
        {error ?? ""}
      </span>
    </div>
  );
}
