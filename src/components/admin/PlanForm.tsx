"use client";

import { useActionState } from "react";

import Alert from "@/components/Alert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/validation";

interface Props {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  /** Present when editing: the plan id and its current values. */
  initial?: { id: string; pricePerMonth: string; features: string; isMostPopular: boolean };
  submitLabel: string;
}

/** Add or edit a membership plan. Features are one per line. */
export default function PlanForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const popular =
    state.values !== undefined
      ? state.values.isMostPopular === "on"
      : (initial?.isMostPopular ?? false);

  return (
    <form className="form form--split" action={formAction} noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <TextField
        name="pricePerMonth"
        label="Price per month (rands)"
        type="number"
        defaultValue={state.values?.pricePerMonth ?? initial?.pricePerMonth}
        error={state.errors?.pricePerMonth}
      />
      <div className="field">
        <label htmlFor={`f-isMostPopular-${initial?.id ?? "new"}`}>Highlight</label>
        <label className="check" htmlFor={`f-isMostPopular-${initial?.id ?? "new"}`}>
          <input
            key={String(popular)}
            id={`f-isMostPopular-${initial?.id ?? "new"}`}
            type="checkbox"
            name="isMostPopular"
            defaultChecked={popular}
          />
          Most popular plan
        </label>
        <span className="error" role="alert">
          {state.errors?.isMostPopular ?? ""}
        </span>
      </div>
      <TextField
        name="features"
        label="Features"
        hint="(one per line, up to 10)"
        multiline
        full
        defaultValue={state.values?.features ?? initial?.features}
        error={state.errors?.features}
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
      </div>
    </form>
  );
}
