"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import Alert from "./Alert";
import FileField from "./FileField";
import SelectField from "./SelectField";

const MAX_BYTES = 4 * 1024 * 1024;

const TYPES = [
  { value: "Medical", label: "Medical" },
  { value: "Licence", label: "Licence" },
  { value: "Other", label: "Other" },
];

/** One error slot per control, plus one for failures that belong to neither. */
interface Errors {
  type?: string;
  file?: string;
  form?: string;
}

/**
 * Upload a medical, licence or other document. The file goes to our own
 * route, which checks it and stores it in the private store; the browser never
 * talks to storage directly.
 *
 * Every error this form can produce is attached to the control that caused it,
 * through the describedBy contract in Field.tsx. The previous version rendered
 * a single message in a separate div, so a screen reader user heard "Choose a
 * file to upload" with no indication of which of the two controls was at
 * fault, and focusing the file input announced nothing at all.
 */
export default function DocumentUploadForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped on a successful upload. FileField tracks the chosen file name in
  // its own state, which form.reset() cannot clear, so remounting it is what
  // puts the field back to "no file chosen".
  const [attempt, setAttempt] = useState(0);

  /** Moves keyboard and screen reader focus to the control that failed. */
  function focusField(name: keyof Errors) {
    document.getElementById(`f-${name}`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setDone(false);

    const data = new FormData(event.currentTarget);
    const type = data.get("type");
    const file = data.get("file");

    if (typeof type !== "string" || type === "") {
      setErrors({ type: "Choose a document type." });
      focusField("type");
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      setErrors({ file: "Choose a file to upload." });
      focusField("file");
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrors({ file: "That file is larger than 4 MB. Choose a smaller one." });
      focusField("file");
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
        const message = json?.error?.message ?? "The document could not be uploaded.";

        // 400 and 413 are the route rejecting the file itself — wrong type, too
        // large, unreadable — so the message belongs on the file input. Anything
        // else (a session that expired, a server fault) is not about either
        // control, and claiming otherwise would send the user to fix the wrong
        // thing.
        setErrors(
          response.status === 400 || response.status === 413
            ? { file: message }
            : { form: message },
        );
        if (response.status === 400 || response.status === 413) focusField("file");
        return;
      }

      form.current?.reset();
      setAttempt((n) => n + 1);
      setDone(true);
      router.refresh();
    } catch {
      setErrors({
        form: "The document could not be uploaded. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} className="form form--split" onSubmit={(event) => void submit(event)} noValidate>
      <SelectField
        name="type"
        label="Document type"
        options={TYPES}
        defaultValue="Medical"
        error={errors.type}
      />

      <FileField
        key={attempt}
        name="file"
        label="File"
        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
        hint="PDF, JPEG or PNG, up to 4 MB"
        error={errors.file}
        required
      />

      <div className="field--full">
        {errors.form && <Alert kind="err">{errors.form}</Alert>}
        {done && <Alert kind="ok">Document uploaded. It is now awaiting review.</Alert>}
        <button className="btn btn--red" type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload document"}
        </button>
      </div>
    </form>
  );
}
