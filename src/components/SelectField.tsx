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
  /** Text of an empty first option, e.g. "No programme". */
  emptyLabel?: string;
}

/**
 * A labelled dropdown with the same error slot as TextField, so selects and
 * inputs look and announce errors identically.
 */
export default function SelectField({
  name,
  label,
  options,
  defaultValue,
  error,
  required = true,
  full = false,
  emptyLabel,
}: Props) {
  const id = `f-${name}`;

  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label htmlFor={id}>{label}</label>

      {/* React 19 resets a form after its action runs, and a select's
          default is only read on mount: keying on it remounts the select with
          the value echoed back, so a choice survives a failed submit. */}
      <select
        key={defaultValue ?? ""}
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
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

      <span className="error" id={`${id}-error`} role="alert">
        {error ?? ""}
      </span>
    </div>
  );
}
