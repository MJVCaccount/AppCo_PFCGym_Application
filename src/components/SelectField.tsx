import Field, { fieldIds } from "./Field";

interface Option {
  value: string;
  label: string;
}

interface Props {
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  hint?: string;
  /** Text of an empty first option, e.g. "No programme". */
  emptyLabel?: string;
  /** Set where the same form renders twice on a page; see fieldIds. */
  scope?: string;
}

/**
 * A labelled dropdown on the same shell as every other control, so selects
 * and inputs look and announce errors identically.
 */
export default function SelectField({
  name,
  label,
  options,
  defaultValue,
  error,
  required = true,
  full = false,
  hint,
  emptyLabel,
  scope,
}: Props) {
  const ids = fieldIds(name, scope);

  return (
    <Field ids={ids} label={label} hint={hint} error={error} full={full}>
      {/* React 19 resets a form after its action runs, and a select's
          default is only read on mount: keying on it remounts the select with
          the value echoed back, so a choice survives a failed submit. */}
      <select
        key={defaultValue ?? ""}
        id={ids.control}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? "true" : "false"}
        required={required}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {emptyLabel === undefined && !defaultValue && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
