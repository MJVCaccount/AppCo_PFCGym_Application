import { respondToOfferAction } from "@/actions/fighter";
import Alert from "@/components/Alert";
import SubmitButton from "@/components/SubmitButton";
import { formatEventDate } from "@/lib/dates";
import { listMyOffers } from "@/lib/services/fighterService";
import { type BoutOffer, formatRecord } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import MemberDashboard from "./MemberDashboard";

/** What the tag on a past bout says: the result, or why there is none. */
function pastLabel(offer: BoutOffer): string {
  if (offer.result === "NoContest") return "No contest";
  if (offer.result) return offer.result;
  if (offer.eventStatus === "Cancelled") return "Event cancelled";
  if (offer.availability === "Declined") return "Declined";
  if (offer.availability === "Pending") return "Not answered";
  return "Result pending";
}

function AnswerButton({
  offer,
  response,
}: {
  offer: BoutOffer;
  response: "Accepted" | "Declined";
}) {
  const accepting = response === "Accepted";

  return (
    <form action={respondToOfferAction}>
      <input type="hidden" name="offerId" value={offer.id} />
      <input type="hidden" name="response" value={response} />
      <SubmitButton
        className={`btn btn--block ${accepting ? "btn--red" : "btn--grey"}`}
        pendingLabel="Saving…"
      >
        {accepting ? "Accept" : "Decline"}
        <span className="sr-only"> the bout at {offer.eventName}</span>
      </SubmitButton>
    </form>
  );
}

/** One open offer. `answers` are the buttons to show under it. */
function OfferCard({
  offer,
  answers,
}: {
  offer: BoutOffer;
  answers: ("Accepted" | "Declined")[];
}) {
  return (
    <article className="dash-card offer">
      <p className="eyebrow">{formatEventDate(offer.eventDate)}</p>
      <h3>{offer.eventName}</h3>
      <p className="offer__venue">{offer.venue}</p>

      <dl className="offer__facts">
        <dt>Opponent</dt>
        <dd>{offer.opponentName ?? "To be confirmed"}</dd>
        <dt>Weight class</dt>
        <dd>{offer.boutWeightClass ?? "To be confirmed"}</dd>
        {offer.boutNotes && (
          <>
            <dt>Notes</dt>
            <dd>{offer.boutNotes}</dd>
          </>
        )}
      </dl>

      <div className="offer__actions">
        {answers.map((response) => (
          <AnswerButton key={response} offer={offer} response={response} />
        ))}
      </div>
    </article>
  );
}

/**
 * A fighter is a member with a fight record, so this is the member dashboard
 * with the fighter's profile, offers and bout history above it. The fighter
 * sections are their own async component, so their queries run alongside the
 * member ones instead of ahead of them.
 */
export default function FighterDashboard({
  session,
}: {
  session: SessionUser;
}) {
  return (
    <MemberDashboard session={session} roleLabel="Fighter">
      <FighterSections session={session} />
    </MemberDashboard>
  );
}

async function FighterSections({ session }: { session: SessionUser }) {
  const result = await listMyOffers(session);

  if (!result.ok || !result.data) {
    return (
      <div style={{ marginBottom: 40 }}>
        <Alert kind="err">
          {result.error ?? "Your fighter profile could not be loaded."}
        </Alert>
      </div>
    );
  }

  const { fighter, pending, accepted, declined, past } = result.data;

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Fighter</p>
        <h2>Your fight card</h2>
      </div>

      <article className="dash-card" style={{ marginBottom: 40 }}>
        <p className="eyebrow">Fighter profile</p>
        <h3 style={{ fontSize: 20, marginTop: 4 }}>{fighter.fullName}</h3>
        <p style={{ color: "var(--mut)", marginTop: 6 }}>
          {fighter.weightClass}
        </p>
        <p className="fighter-record">{formatRecord(fighter)}</p>
        <p style={{ color: "var(--mut)" }}>wins, losses, draws</p>
      </article>

      <div className="section-head">
        <h2>Pending offers</h2>
      </div>
      {pending.length === 0 ? (
        <p className="lead" style={{ marginBottom: 40 }}>
          No bout offers yet. Your coach or the gym admin will send offers
          here.
        </p>
      ) : (
        <div className="dash-grid dash-grid--2" style={{ marginBottom: 40 }}>
          {pending.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              answers={["Accepted", "Declined"]}
            />
          ))}
        </div>
      )}

      <div className="section-head">
        <h2>Upcoming bouts</h2>
      </div>
      {accepted.length === 0 ? (
        <p className="lead" style={{ marginBottom: 40 }}>
          No accepted bouts yet. Offers you accept will appear here.
        </p>
      ) : (
        <div className="dash-grid dash-grid--2" style={{ marginBottom: 40 }}>
          {accepted.map((offer) => (
            <OfferCard key={offer.id} offer={offer} answers={["Declined"]} />
          ))}
        </div>
      )}

      {declined.length > 0 && (
        <>
          <div className="section-head">
            <h2>Declined offers</h2>
            <p className="lead">
              You can still accept these until the event starts.
            </p>
          </div>
          <div className="dash-grid dash-grid--2" style={{ marginBottom: 40 }}>
            {declined.map((offer) => (
              <OfferCard key={offer.id} offer={offer} answers={["Accepted"]} />
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2>Past bouts</h2>
      </div>
      {past.length === 0 ? (
        <p className="lead" style={{ marginBottom: 40 }}>
          No past bouts yet. Results appear here after each event.
        </p>
      ) : (
        <div style={{ marginBottom: 40 }}>
          {past.map((offer) => (
            <div className="slot" key={offer.id}>
              <p className="slot__info">
                <b>{offer.eventName}</b>
                <span>
                  {formatEventDate(offer.eventDate)}
                  {offer.opponentName ? ` · vs ${offer.opponentName}` : ""}
                  {offer.resultNotes ? ` · ${offer.resultNotes}` : ""}
                </span>
              </p>
              <span className="tag">{pastLabel(offer)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
