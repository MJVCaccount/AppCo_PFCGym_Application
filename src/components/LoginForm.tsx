"use client";

import Link from "next/link";
import { useActionState } from "react";

import { login } from "@/actions/auth";
import { EMPTY_FORM_STATE } from "@/lib/validation";

import Alert from "./Alert";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

export default function LoginForm({ returnUrl }: { returnUrl?: string }) {
  const [state, formAction] = useActionState(login, EMPTY_FORM_STATE);

  return (
    <form className="form" action={formAction} noValidate>
      {returnUrl && <input type="hidden" name="returnUrl" value={returnUrl} />}

      <TextField
        name="email"
        label="Email address"
        type="email"
        placeholder="your@gmail.com"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />

      <PasswordField
        name="password"
        label="Password"
        autoComplete="current-password"
        error={state.errors?.password}
      >
        <p style={{ textAlign: "right", marginTop: 8 }}>
          <Link
            href="/forgot-password"
            style={{
              fontSize: 11,
              color: "var(--red)",
              fontWeight: 700,
            }}
          >
            Forgot password?
          </Link>
        </p>
      </PasswordField>

      {state.message && <Alert kind="err">{state.message}</Alert>}

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
