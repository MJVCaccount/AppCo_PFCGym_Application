import type { Metadata } from "next";

import ClassCard from "@/components/ClassCard";
import StickyCta from "@/components/StickyCta";
import { getClasses } from "@/lib/repositories/programmesRepository";

export const metadata: Metadata = {
  title: "Classes",
  description:
    "Boxing, MMA, Muay Thai, strength and grappling classes for all levels at PFC Cape Town.",
};

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  const classes = await getClasses();

  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Training programmes</p>
            <h2>All classes</h2>
            <p className="lead">
              Find the perfect class for your goals and experience level. Every
              class is open to members on any plan.
            </p>
          </div>

          <div className="grid grid--3">
            {classes.map((gymClass) => (
              <ClassCard key={gymClass.id} gymClass={gymClass} />
            ))}
          </div>
        </div>
      </section>

      <StickyCta />
    </>
  );
}
