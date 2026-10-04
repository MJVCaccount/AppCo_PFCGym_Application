"use client";

import { useActionState } from "react";

import { requestPasswordReset } from "@/actions/auth";
import { EMPTY_FORM_STATE } from "@/lib/validation";

import Alert from "./Alert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordReset,
    EMPTY_FORM_STATE,
  );

  return (
    <form className="form" action={formAction} noValidate>
      <TextField
        name="email"
        label="Email address"
        type="email"
        placeholder="your@gmail.com"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />

      {state.message && (
        <Alert kind={state.ok ? "ok" : "err"}>{state.message}</Alert>
      )}

      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
