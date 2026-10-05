"use client";

import { useActionState } from "react";

import { submitPasswordReset } from "@/actions/auth";
import { EMPTY_FORM_STATE } from "@/lib/validation";

import Alert from "./Alert";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    submitPasswordReset,
    EMPTY_FORM_STATE,
  );

  return (
    <form className="form" action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />

      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        error={state.errors?.password}
      />

      {state.message && <Alert kind="err">{state.message}</Alert>}

      <SubmitButton pendingLabel="Saving…">Set new password</SubmitButton>
    </form>
  );
}
