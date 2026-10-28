"use client";

import { useState } from "react";

import Field, { fieldIds } from "./Field";

interface Props {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  error?: string;
  hint?: string;
  /** Rendered below the error slot, e.g. the "Forgot password?" link. */
  children?: React.ReactNode;
  /** Set where the same form renders twice on a page; see fieldIds. */
  scope?: string;
}

export default function PasswordField({
  name,
  label,
  autoComplete,
  placeholder = "••••••••",
  error,
  hint,
  children,
  scope,
}: Props) {
  // Was useId(), which produces a fresh id every render pass. The id is now
  // derived from the field name like every other control, so the hint and
  // error ids are stable and predictable.
  const ids = fieldIds(name, scope);
  const [visible, setVisible] = useState(false);

  return (
    <Field
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      footer={children}
    >
      <div className="field__row">
        <input
          id={ids.control}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-describedby={ids.describedBy}
          aria-invalid={error ? "true" : "false"}
          required
        />
        <button
          className="toggle-pw"
          type="button"
          onClick={() => setVisible((v) => !v)}
          // The button changes a state rather than performing an action, so it
          // needs aria-pressed; aria-controls names what it changes.
          aria-pressed={visible}
          aria-controls={ids.control}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </Field>
  );
}
