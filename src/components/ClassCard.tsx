import Image from "next/image";
import Link from "next/link";

import type { GymClass } from "@/lib/types";

interface Props {
  gymClass: GymClass;
  showBook?: boolean;
}

export default function ClassCard({ gymClass, showBook = true }: Props) {
  return (
    <article className="card reveal">
      <Image
        className="card__media"
        src={`/images/class-${gymClass.slug}.jpg`}
        alt={`${gymClass.name} training area at PFC`}
        width={800}
        height={600}
      />
      <div className="card__body">
        <h3>{gymClass.name}</h3>
        <p>{gymClass.description}</p>
        <div className="card__tags">
          <span className="tag">{gymClass.level}</span>
          <span className="tag">{gymClass.durationMinutes} min</span>
        </div>
        {showBook && (
          <Link
            className="btn btn--red btn--block btn--sm"
            href="/timetable"
            style={{ marginTop: 14 }}
          >
            Book class
          </Link>
        )}
      </div>
    </article>
  );
}
