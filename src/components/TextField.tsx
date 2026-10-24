import { type HTMLInputTypeAttribute } from "react";

import Field, { fieldIds } from "./Field";

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
  /** Set where the same form renders twice on a page; see fieldIds. */
  scope?: string;
}

/**
 * One labelled input with its hint and error slots.
 *
 * The aria wiring lives in Field, so it is identical here, in SelectField,
 * PasswordField and FileField, and a new field type cannot quietly ship
 * without it.
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
  scope,
}: Props) {
  const ids = fieldIds(name, scope);

  // The hint used to sit inside the <label>, which made the label's accessible
  // name "Phone Optional" rather than "Phone". It is a description, not part
  // of the name, so it belongs in the hint slot that describedBy points at.
  const shared = {
    id: ids.control,
    name,
    placeholder,
    defaultValue,
    required,
    "aria-describedby": ids.describedBy,
    "aria-invalid": error ? ("true" as const) : ("false" as const),
  };

  return (
    <Field ids={ids} label={label} hint={hint} error={error} full={full}>
      {multiline ? (
        <textarea {...shared} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
    </Field>
  );
}
