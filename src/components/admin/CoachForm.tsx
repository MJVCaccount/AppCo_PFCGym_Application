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

/** Add or edit a coach. A new coach gets an invitation to set a password. */
export default function CoachForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  // This form renders more than once on its page, so every field id is
  // namespaced to the record being edited; see fieldIds in Field.tsx.
  const scope = initial?.id ?? "new";
  const value = (name: string) => state.values?.[name] ?? initial?.[name];
  const error = (name: string) => state.errors?.[name];

  return (
    <form className="form form--split" action={formAction} noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <TextField scope={scope} name="fullName" label="Full name" autoComplete="off" defaultValue={value("fullName")} error={error("fullName")} />
      <TextField scope={scope} name="email" label="Email" type="email" autoComplete="off" defaultValue={value("email")} error={error("email")} />
      <TextField scope={scope} name="title" label="Title" placeholder="Head boxing coach" defaultValue={value("title")} error={error("title")} />
      <TextField scope={scope}
        name="imageUrl"
        label="Photo link"
        hint="(optional, https)"
        required={false}
        defaultValue={value("imageUrl")}
        error={error("imageUrl")}
      />
      <ImageUploadField label="Upload a photo" />
      <TextField scope={scope} name="bio" label="Bio" multiline full defaultValue={value("bio")} error={error("bio")} />

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
