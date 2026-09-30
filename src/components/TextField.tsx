import { type HTMLInputTypeAttribute } from "react";

interface Props {
  name: string;
  label: string;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  multiline?: boolean;
  hint?: string;
}

/**
 * One labelled input with its error slot. Every field on the site goes
 * through this, so the label association and aria wiring cannot drift.
 */
export default function TextField({
  name,
  label,
  type = "text",
  placeholder,
  autoComplete,
  defaultValue,
  error,
  required = true,
  full = false,
  multiline = false,
  hint,
}: Props) {
  const id = `f-${name}`;
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className={`field${full ? " field--full" : ""}`}>
      <label htmlFor={id}>
        {label}
        {hint && (
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {" "}
            {hint}
          </span>
        )}
      </label>

      {multiline ? (
        <textarea
          id={id}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          required={required}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          required={required}
        />
      )}

      <span className="error" id={`${id}-error`} role="alert">
        {error ?? ""}
      </span>
    </div>
  );
}
