"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Upload a medical, licence or other document. The file goes to our own
 * route, which checks it and stores it in the private store; the browser never
 * talks to storage directly.
 */
export default function DocumentUploadForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const data = new FormData(event.currentTarget);
    const file = data.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 4 MB. Choose a smaller one.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/fighter/documents", {
        method: "POST",
        body: data,
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(json?.error?.message ?? "The document could not be uploaded.");
        return;
      }

      form.current?.reset();
      router.refresh();
    } catch {
      setError("The document could not be uploaded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} className="form form--split" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="doc-type">Document type</label>
        <select id="doc-type" name="type" defaultValue="Medical" required>
          <option value="Medical">Medical</option>
          <option value="Licence">Licence</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="doc-file">
          File
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {" "}
            (PDF, JPEG or PNG, up to 4 MB)
          </span>
        </label>
        <input
          id="doc-file"
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          required
        />
      </div>

      <div className="field--full">
        <span className="error" role="alert">
          {error}
        </span>
        <button className="btn btn--red" type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload document"}
        </button>
      </div>
    </form>
  );
}
