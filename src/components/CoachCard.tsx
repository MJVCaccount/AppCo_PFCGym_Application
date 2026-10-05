import Image from "next/image";

import type { Coach } from "@/lib/types";
import { initials } from "@/lib/types";

/**
 * next/image only loads hosts listed in next.config.mjs, and a coach's image
 * link may be any https address an admin typed. Anything but the public Blob
 * host falls back to the monogram instead of breaking the page.
 */
function isPublicBlobImage(url: string | null): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * Shows the coach's uploaded photo when there is one, and otherwise a monogram
 * built from their name.
 */
export default function CoachCard({ coach }: { coach: Coach }) {
  return (
    <article className="coach reveal">
      {isPublicBlobImage(coach.imageUrl) ? (
        <div
          className="coach__avatar"
          style={{ position: "relative", overflow: "hidden" }}
        >
          <Image
            src={coach.imageUrl}
            alt={`${coach.name}, ${coach.role}`}
            fill
            sizes="76px"
            style={{ objectFit: "cover" }}
          />
        </div>
      ) : (
        <div className="coach__avatar" aria-hidden="true">
          {initials(coach.name)}
        </div>
      )}
      <h3>{coach.name}</h3>
      <p className="coach__role">{coach.role}</p>
      <p>{coach.bio}</p>
    </article>
  );
}
