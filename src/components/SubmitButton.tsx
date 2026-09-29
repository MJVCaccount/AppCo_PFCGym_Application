"use client";

import { useFormStatus } from "react-dom";

interface Props {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}

/**
 * Disables itself while the server action runs, so a slow connection cannot
 * produce a double submission.
 */
export default function SubmitButton({
  children,
  pendingLabel = "Sending…",
  className = "btn btn--red btn--block",
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      data-pending={pending ? "true" : undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
