import type { Coach } from "@/lib/types";
import { initials } from "@/lib/types";

/**
 * The client supplied no photographs of people, so the avatar is a monogram
 * built from the coach's name. If portraits arrive, swap the div for an
 * <Image> — nothing else changes.
 */
export default function CoachCard({ coach }: { coach: Coach }) {
  return (
    <article className="coach reveal">
      <div className="coach__avatar" aria-hidden="true">
        {initials(coach.name)}
      </div>
      <h3>{coach.name}</h3>
      <p className="coach__role">{coach.role}</p>
      <p>{coach.bio}</p>
    </article>
  );
}
