"use client";

import { useId, useRef, useState } from "react";

import Field, { fieldIds } from "../Field";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Picks an image, uploads it to the public store through the admin upload
 * route, and puts the returned link in the form's `imageUrl` field.
 *
 * The file input has no name, so the file itself is never posted with the
 * form: only the link is saved.
 *
 * Progress and success go in the hint slot, which is a live region here
 * because its text changes; failures go in the error slot. They were one node
 * whose `role` was swapped between "status" and "alert", which a screen reader
 * does not reliably pick up once the node is in the document — and neither was
 * referenced by the input, so focusing it announced nothing.
 */
export default function ImageUploadField({ label }: { label: string }) {
  // Two of these render on one page (the edit form and the create form on
  // /admin/events), so the ids have to be per instance. A fixed id would be
  // duplicated and every htmlFor and aria-describedby would resolve to
  // whichever field happened to come first in the document.
  const ids = fieldIds(`image-${useId()}`);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setError("");
    setProgress("");

    if (file.size > MAX_BYTES) {
      setError("That image is larger than 2 MB. Choose a smaller one.");
      return;
    }

    setBusy(true);
    setProgress(`Uploading ${file.name}…`);

    try {
      const body = new FormData();
      body.set("file", file);

      const response = await fetch("/api/admin/uploads/image", {
        method: "POST",
        body,
      });
      const json = (await response.json().catch(() => null)) as {
        url?: string;
        error?: { message?: string };
      } | null;

      if (!response.ok || !json?.url) {
        setProgress("");
        setError(json?.error?.message ?? "The image could not be uploaded.");
        return;
      }

      const target = input.current?.form?.elements.namedItem("imageUrl");
      if (target instanceof HTMLInputElement) target.value = json.url;
      setProgress("Image uploaded. Save the form to use it.");
    } catch {
      setProgress("");
      setError("The image could not be uploaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field
      ids={ids}
      label={label}
      // Was inside the <label>, which made the control's accessible name
      // "Hero image (JPEG, PNG or WebP, up to 2 MB)".
      hint={progress || "JPEG, PNG or WebP, up to 2 MB"}
      error={error}
      liveHint
    >
      <input
        ref={input}
        id={ids.control}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? "true" : "false"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </Field>
  );
}
