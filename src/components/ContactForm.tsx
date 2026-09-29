"use client";

import { useActionState } from "react";

import { sendEnquiry } from "@/actions/gym";
import { EMPTY_FORM_STATE } from "@/lib/validation";

import Alert from "./Alert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

export default function ContactForm() {
  const [state, formAction] = useActionState(sendEnquiry, EMPTY_FORM_STATE);

  return (
    <form className="form form--split" action={formAction} noValidate>
      <TextField
        name="fullName"
        label="Full name"
        placeholder="Your full name"
        autoComplete="name"
        defaultValue={state.values?.fullName}
        error={state.errors?.fullName}
      />
      <TextField
        name="email"
        label="Email"
        type="email"
        placeholder="your@gmail.com"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <TextField
        name="phone"
        label="Phone"
        hint="(optional)"
        type="tel"
        placeholder="+27 …"
        autoComplete="tel"
        required={false}
        defaultValue={state.values?.phone}
        error={state.errors?.phone}
      />
      <TextField
        name="message"
        label="Message"
        placeholder="Tell us about your goals…"
        multiline
        full
        defaultValue={state.values?.message}
        error={state.errors?.message}
      />

      {state.message && (
        <div className="field--full">
          <Alert kind={state.ok ? "ok" : "err"}>{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
        <p className="form-note" style={{ marginTop: 12 }}>
          We usually reply within one working day.
        </p>
      </div>
    </form>
  );
}
