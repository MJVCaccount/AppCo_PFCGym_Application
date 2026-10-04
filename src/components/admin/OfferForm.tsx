"use client";

import { useActionState, useState } from "react";

import { offerBoutAction } from "@/actions/admin";
import Alert from "@/components/Alert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { EMPTY_FORM_STATE } from "@/lib/validation";

interface Props {
  eventId: number;
  fighters: { id: number; name: string; hasApprovedMedical: boolean }[];
}

/**
 * Offer a bout at one event to a fighter. A fighter with no approved medical
 * document is flagged, but the offer is still allowed: it is a warning only.
 */
export default function OfferForm({ eventId, fighters }: Props) {
  const [state, formAction] = useActionState(offerBoutAction, EMPTY_FORM_STATE);
  const error = (name: string) => state.errors?.[name];
  const [chosen, setChosen] = useState(state.values?.fighterId ?? "");
  const noMedical = fighters.some(
    (f) => String(f.id) === chosen && !f.hasApprovedMedical,
  );

  return (
    <form
      className="form form--split"
      action={formAction}
      noValidate
      onChange={(event) => {
        const target = event.target as HTMLSelectElement;
        if (target.name === "fighterId") setChosen(target.value);
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />

      <SelectField
        name="fighterId"
        label="Fighter"
        defaultValue={state.values?.fighterId}
        error={error("fighterId")}
        options={fighters.map((f) => ({
          value: String(f.id),
          label: f.hasApprovedMedical ? f.name : `${f.name} (no approved medical)`,
        }))}
      />
      {noMedical && (
        <div className="field">
          <span className="tag tag--red" role="status">
            No approved medical on file
          </span>
        </div>
      )}
      <TextField
        name="opponentName"
        label="Opponent"
        hint="(optional)"
        required={false}
        defaultValue={state.values?.opponentName}
        error={error("opponentName")}
      />
      <TextField
        name="boutWeightClass"
        label="Weight class"
        hint="(optional)"
        required={false}
        defaultValue={state.values?.boutWeightClass}
        error={error("boutWeightClass")}
      />
      <TextField
        name="boutNotes"
        label="Notes"
        hint="(optional)"
        multiline
        full
        required={false}
        defaultValue={state.values?.boutNotes}
        error={error("boutNotes")}
      />

      {state.message && (
        <div className="field--full">
          <Alert kind="err">{state.message}</Alert>
        </div>
      )}

      <div className="field--full">
        <SubmitButton className="btn btn--red" pendingLabel="Sending offer…">
          Offer bout
        </SubmitButton>
      </div>
    </form>
  );
}
