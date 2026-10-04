import type { Metadata } from "next";

import CoachCard from "@/components/CoachCard";
import StickyCta from "@/components/StickyCta";
import { getCoaches } from "@/lib/repositories/coachesRepository";

export const metadata: Metadata = {
  title: "Coaches",
  description:
    "Meet the PFC coaching team: championship boxers, national Muay Thai champions and BJJ black belts.",
};

export const dynamic = "force-dynamic";

export default async function CoachesPage() {
  const coaches = await getCoaches();

  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Expert coaching</p>
            <h2>Our coaches</h2>
            <p className="lead">
              World-class coaches committed to your performance and growth.
            </p>
          </div>

          <div className="grid grid--3">
            {coaches.map((coach) => (
              <CoachCard key={coach.id} coach={coach} />
            ))}
          </div>
        </div>
      </section>

      <StickyCta />
    </>
  );
}
