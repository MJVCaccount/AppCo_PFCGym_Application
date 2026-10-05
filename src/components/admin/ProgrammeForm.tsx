"use client";

import { useActionState } from "react";

import Alert from "@/components/Alert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/validation";

interface Props {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  initial?: Record<string, string>;
  submitLabel: string;
}

/** Add or edit a programme in the public Classes catalogue. */
export default function ProgrammeForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const value = (name: string) => state.values?.[name] ?? initial?.[name];
  const error = (name: string) => state.errors?.[name];

  return (
    <form className="form form--split" action={formAction} noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <TextField name="name" label="Programme name" defaultValue={value("name")} error={error("name")} />
      <TextField name="level" label="Level" placeholder="All levels" defaultValue={value("level")} error={error("level")} />
      <TextField
        name="durationMinutes"
        label="Duration (minutes)"
        type="number"
        defaultValue={value("durationMinutes") ?? "60"}
        error={error("durationMinutes")}
      />
      <TextField
        name="description"
        label="Description"
        multiline
        full
        defaultValue={value("description")}
        error={error("description")}
      />

      {state.message && (
        <div className="field--full">
          <Alert kind="err">{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton className="btn btn--red" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        <p className="help">The web address is made from the name; it cannot be typed in.</p>
      </div>
    </form>
  );
}
