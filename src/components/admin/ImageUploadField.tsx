"use client";

import { useId, useRef, useState } from "react";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Picks an image, uploads it to the public store through the admin upload
 * route, and puts the returned link in the form's `imageUrl` field.
 *
 * The file input has no name, so the file itself is never posted with the
 * form: only the link is saved.
 */
export default function ImageUploadField({ label }: { label: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setFailed(false);

    if (file.size > MAX_BYTES) {
      setFailed(true);
      setMessage("That image is larger than 2 MB. Choose a smaller one.");
      return;
    }

    setBusy(true);
    setMessage("Uploading…");

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
        setFailed(true);
        setMessage(json?.error?.message ?? "The image could not be uploaded.");
        return;
      }

      const target = input.current?.form?.elements.namedItem("imageUrl");
      if (target instanceof HTMLInputElement) target.value = json.url;
      setMessage("Image uploaded. Save the form to use it.");
    } catch {
      setFailed(true);
      setMessage("The image could not be uploaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        <span style={{ textTransform: "none", letterSpacing: 0 }}>
          {" "}
          (JPEG, PNG or WebP, up to 2 MB)
        </span>
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <span
        className="error"
        role={failed ? "alert" : "status"}
        style={failed ? undefined : { color: "inherit" }}
      >
        {message}
      </span>
    </div>
  );
}
