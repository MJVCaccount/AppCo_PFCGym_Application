"use client";

import { useActionState } from "react";

import { promoteFighterAction } from "@/actions/admin";
import Alert from "@/components/Alert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE } from "@/lib/validation";

/** Promote a member to Fighter, with their weight class. */
export default function PromoteForm({
  members,
}: {
  members: { id: number; fullName: string; email: string }[];
}) {
  const [state, formAction] = useActionState(promoteFighterAction, EMPTY_FORM_STATE);

  return (
    <form className="form form--split" action={formAction} noValidate>
      <SelectField
        name="memberId"
        label="Member"
        defaultValue={state.values?.memberId}
        error={state.errors?.memberId}
        options={members.map((m) => ({
          value: String(m.id),
          label: `${m.fullName} (${m.email})`,
        }))}
      />
      <TextField
        name="weightClass"
        label="Weight class"
        placeholder="Welterweight"
        defaultValue={state.values?.weightClass}
        error={state.errors?.weightClass}
      />

      {state.message && (
        <div className="field--full">
          <Alert kind="err">{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton className="btn btn--red" pendingLabel="Promoting…">
          Promote to fighter
        </SubmitButton>
      </div>
    </form>
  );
}
