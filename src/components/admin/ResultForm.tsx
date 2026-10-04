"use client";

import { useActionState } from "react";

import { recordResultAction } from "@/actions/admin";
import Alert from "@/components/Alert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE } from "@/lib/validation";

interface Props {
  eventId: number;
  offerId: number;
  fighterName: string;
  current: { result: string | null; notes: string | null };
}

const RESULTS = [
  { value: "Win", label: "Win" },
  { value: "Loss", label: "Loss" },
  { value: "Draw", label: "Draw" },
  { value: "NoContest", label: "No contest" },
];

/** Record or change the result of one accepted bout, after the event. */
export default function ResultForm({ eventId, offerId, fighterName, current }: Props) {
  const [state, formAction] = useActionState(recordResultAction, EMPTY_FORM_STATE);
  const error = (name: string) => state.errors?.[name];

  return (
    <form className="form form--split" action={formAction} noValidate>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="offerId" value={offerId} />

      <SelectField
        name="result"
        label={`Result for ${fighterName}`}
        required={false}
        emptyLabel="No result yet"
        defaultValue={state.values?.result ?? current.result ?? ""}
        error={error("result")}
        options={RESULTS}
      />
      <TextField
        name="notes"
        label="Notes"
        hint="(optional)"
        required={false}
        defaultValue={state.values?.notes ?? current.notes ?? ""}
        error={error("notes")}
      />

      {state.message && (
        <div className="field--full">
          <Alert kind="err">{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton className="btn btn--red btn--sm" pendingLabel="Saving…">
          Record result
        </SubmitButton>
      </div>
    </form>
  );
}
