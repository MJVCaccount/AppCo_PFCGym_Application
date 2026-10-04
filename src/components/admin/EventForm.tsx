"use client";

import { useActionState } from "react";

import ImageUploadField from "@/components/admin/ImageUploadField";
import Alert from "@/components/Alert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/validation";

interface Props {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  initial?: Record<string, string>;
  submitLabel: string;
}

/**
 * Create or edit a competition event. The date box is the gym's own clock
 * (Africa/Johannesburg); the action adds the +02:00 offset the service needs.
 */
export default function EventForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const value = (name: string) => state.values?.[name] ?? initial?.[name];
  const error = (name: string) => state.errors?.[name];

  return (
    <form className="form form--split" action={formAction} noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <TextField name="name" label="Event name" defaultValue={value("name")} error={error("name")} />
      <TextField name="venue" label="Venue" defaultValue={value("venue")} error={error("venue")} />
      <TextField
        name="eventDate"
        label="Date and time"
        hint="(Johannesburg time)"
        type="datetime-local"
        defaultValue={value("eventDate")}
        error={error("eventDate")}
      />
      <TextField
        name="imageUrl"
        label="Poster link"
        hint="(optional)"
        required={false}
        defaultValue={value("imageUrl")}
        error={error("imageUrl")}
      />
      <ImageUploadField label="Upload a poster" />
      <TextField name="description" label="Description" multiline full defaultValue={value("description")} error={error("description")} />

      {state.message && (
        <div className="field--full">
          <Alert kind="err">{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton className="btn btn--red" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
