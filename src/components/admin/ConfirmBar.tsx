import Link from "next/link";

import SubmitButton from "@/components/SubmitButton";

interface Props {
  /** What will happen, including any counts. */
  message: string;
  action: (data: FormData) => Promise<void>;
  /** Hidden fields the action needs. */
  fields: Record<string, string | number>;
  confirmLabel: string;
  /** Where "Keep" goes: the same page without the confirm step. */
  cancelHref: string;
}

/**
 * The second step of a destructive action. It is a plain form, so it works
 * with JavaScript off: the first click was a link that opened this bar, and
 * nothing changes until this submit button is pressed.
 */
export default function ConfirmBar({
  message,
  action,
  fields,
  confirmLabel,
  cancelHref,
}: Props) {
  return (
    <div className="admin-confirm" role="group" aria-label="Confirm">
      <p>{message}</p>
      <div className="admin-actions">
        <form action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton className="btn btn--red btn--sm" pendingLabel="Working…">
            {confirmLabel}
          </SubmitButton>
        </form>
        <Link className="btn btn--line btn--sm" href={cancelHref} scroll={false}>
          Keep
        </Link>
      </div>
    </div>
  );
}
