"use client";

import { useActionState } from "react";

import { register } from "@/actions/auth";
import type { MembershipPlan } from "@/lib/types";
import { formatPrice } from "@/lib/types";
import { EMPTY_FORM_STATE } from "@/lib/validation";

import Alert from "./Alert";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

interface Props {
  plans: MembershipPlan[];
  selectedPlanId?: string;
}

export default function RegisterForm({ plans, selectedPlanId }: Props) {
  const [state, formAction] = useActionState(register, EMPTY_FORM_STATE);

  return (
    <form className="form" action={formAction} noValidate>
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
        label="Email address"
        type="email"
        placeholder="your@gmail.com"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.errors?.email}
      />
      <TextField
        name="phone"
        label="Phone"
        type="tel"
        placeholder="+27 …"
        autoComplete="tel"
        required={false}
        defaultValue={state.values?.phone}
        error={state.errors?.phone}
      />

      <div className="field">
        <label htmlFor="f-planId">Membership plan</label>
        <select
          id="f-planId"
          name="planId"
          defaultValue={state.values?.planId ?? selectedPlanId ?? ""}
          aria-invalid={state.errors?.planId ? "true" : undefined}
        >
          <option value="">Choose a plan</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              R{formatPrice(plan.pricePerMonth)} / month
            </option>
          ))}
        </select>
        <span className="error" role="alert">
          {state.errors?.planId ?? ""}
        </span>
      </div>

      <PasswordField
        name="password"
        label="Password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        error={state.errors?.password}
      />

      {state.message && <Alert kind="err">{state.message}</Alert>}

      <SubmitButton pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
