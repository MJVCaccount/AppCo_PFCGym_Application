"use client";

import { useActionState } from "react";

import Alert from "@/components/Alert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { CLASS_KINDS, DAY_NAMES, DAY_ORDER } from "@/lib/types";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/validation";

interface Props {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  coaches: { id: number; name: string }[];
  programmes: { id: number; name: string }[];
  /** Present when editing: the class id and its current values. */
  initial?: Record<string, string>;
  submitLabel: string;
}

/** Add or edit a scheduled class. Values come back after an error. */
export default function ClassForm({
  action,
  coaches,
  programmes,
  initial,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState(action, EMPTY_FORM_STATE);
  const value = (name: string) => state.values?.[name] ?? initial?.[name];
  const error = (name: string) => state.errors?.[name];

  return (
    <form className="form form--split" action={formAction} noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <TextField name="name" label="Class name" defaultValue={value("name")} error={error("name")} />
      <SelectField
        name="kind"
        label="Kind"
        defaultValue={value("kind") ?? "Group"}
        error={error("kind")}
        options={CLASS_KINDS.map((kind) => ({ value: kind, label: kind }))}
      />
      <SelectField
        name="coachId"
        label="Coach"
        defaultValue={value("coachId")}
        error={error("coachId")}
        options={coaches.map((c) => ({ value: String(c.id), label: c.name }))}
      />
      <SelectField
        name="programmeId"
        label="Programme"
        required={false}
        emptyLabel="No programme"
        defaultValue={value("programmeId")}
        error={error("programmeId")}
        options={programmes.map((p) => ({ value: String(p.id), label: p.name }))}
      />
      <SelectField
        name="day"
        label="Day"
        defaultValue={value("day")}
        error={error("day")}
        options={DAY_ORDER.map((day) => ({ value: day, label: DAY_NAMES[day] }))}
      />
      <TextField
        name="startsAt"
        label="Starts at"
        type="time"
        defaultValue={value("startsAt")}
        error={error("startsAt")}
      />
      <TextField
        name="durationMinutes"
        label="Duration (minutes)"
        type="number"
        defaultValue={value("durationMinutes") ?? "60"}
        error={error("durationMinutes")}
      />
      <TextField
        name="capacity"
        label="Capacity"
        type="number"
        defaultValue={value("capacity") ?? "20"}
        error={error("capacity")}
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
