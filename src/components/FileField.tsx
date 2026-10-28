"use client";

import { useState } from "react";

import Field, { fieldIds } from "./Field";

interface Props {
  name: string;
  label: string;
  /** Mirrors what the route enforces — never the only check. */
  accept: string;
  hint?: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  /** Set where the same form renders twice on a page; see fieldIds. */
  scope?: string;
}

/**
 * File input with its errors wired to the control.
 *
 * A file input is the field most likely to produce an error the user did not
 * expect — wrong type, too large — and the least likely to make that error
 * discoverable, because the browser's own "No file chosen" text sits between
 * the control and anything we render. It goes through the same describedBy
 * contract as every other field.
 *
 * The chosen file's name replaces the hint once a file is picked, so a screen
 * reader user gets confirmation the selection landed: the native control
 * announces only "button" plus the file name on focus, which is easy to miss.
 */
export default function FileField({
  name,
  label,
  accept,
  hint,
  error,
  required = false,
  full = false,
  scope,
}: Props) {
  const ids = fieldIds(name, scope);
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <Field
      ids={ids}
      label={label}
      hint={chosen ? `Selected: ${chosen}` : hint}
      error={error}
      full={full}
      liveHint
    >
      <input
        id={ids.control}
        name={name}
        type="file"
        accept={accept}
        required={required}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? "true" : "false"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          setChosen(file ? file.name : null);
        }}
      />
    </Field>
  );
}
