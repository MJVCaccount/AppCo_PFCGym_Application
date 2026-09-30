"use client";

import { useId, useState } from "react";

interface Props {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  error?: string;
  children?: React.ReactNode;
}

export default function PasswordField({
  name,
  label,
  autoComplete,
  placeholder = "••••••••",
  error,
  children,
}: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__row">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          required
        />
        <button
          className="toggle-pw"
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <span className="error" id={`${id}-error`} role="alert">
        {error ?? ""}
      </span>
      {children}
    </div>
  );
}
