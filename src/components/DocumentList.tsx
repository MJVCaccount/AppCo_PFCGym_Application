"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatEventDate } from "@/lib/dates";
import type { FighterDocument } from "@/lib/types";

const STATUS_TAG = {
  Pending: "",
  Approved: "tag--ok",
  Rejected: "tag--red",
} as const;

/** The fighter's own documents, each with its review status and a delete button where allowed. */
export default function DocumentList({
  documents,
}: {
  documents: FighterDocument[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(document: FighterDocument) {
    setError("");
    setBusyId(document.id);

    try {
      const response = await fetch(`/api/fighter/documents/${document.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(json?.error?.message ?? "The document could not be deleted.");
        return;
      }

      router.refresh();
    } catch {
      setError("The document could not be deleted. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (documents.length === 0) {
    return <p className="lead">You have not uploaded any documents yet.</p>;
  }

  return (
    <div>
      <span className="error" role="alert">
        {error}
      </span>
      {documents.map((document) => (
        <div className="slot" key={document.id}>
          <p className="slot__info">
            <b>
              {document.type} · {document.fileName}
            </b>
            <span>
              Uploaded {formatEventDate(document.uploadedAt)}
              {document.reviewNote ? ` · Note from the gym: ${document.reviewNote}` : ""}
            </span>
          </p>
          <span className={`tag ${STATUS_TAG[document.status]}`}>{document.status}</span>
          <a
            className="btn btn--grey btn--sm"
            href={`/api/documents/${document.id}`}
            aria-label={`Download ${document.type} document ${document.fileName}`}
          >
            Download
          </a>
          {document.status !== "Approved" && (
            <button
              className="btn btn--line btn--sm"
              type="button"
              disabled={busyId === document.id}
              onClick={() => void remove(document)}
              aria-label={`Delete ${document.type} document ${document.fileName}`}
            >
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
