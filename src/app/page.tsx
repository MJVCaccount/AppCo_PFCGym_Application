import Image from "next/image";
import Link from "next/link";

import ClassCard from "@/components/ClassCard";
import CoachCard from "@/components/CoachCard";
import PlanCard from "@/components/PlanCard";
import StickyCta from "@/components/StickyCta";
import {
  getCheapestPlanPrice,
  getClasses,
  getCoaches,
  getHoursFor,
  getPlans,
  getReviews,
  getTimetable,
  isOpenAt,
} from "@/lib/gym-data";
import { formatHours, formatPrice, initials, timeAgo, todayKey } from "@/lib/types";

// The hero shows whether the gym is open right now, so this page cannot be
// baked at build time — it renders per request.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const classes = getClasses();
  const coaches = getCoaches();
  const plans = getPlans();
  const reviews = getReviews();
  const hours = getHoursFor(todayKey());
  const open = isOpenAt();

  return (
    <>
      <section className="hero">
        <Image
          className="hero__bg"
          src="/images/hero.jpg"
          alt=""
          aria-hidden="true"
          width={1200}
          height={675}
          priority
        />
        <div className="wrap">
          <h1>
            Professional <em>Fighting</em> Championship
          </h1>
          <p className="hero__sub">
            Elite boxing, MMA and strength training under world-class coaches.
            Your journey to the top starts here.
          </p>

          <div className="hero__cta">
            <Link className="btn btn--red" href="/memberships">
              Join now &rarr;
            </Link>
            <Link className="btn btn--ghost" href="/promo">
              Fight events
            </Link>
          </div>

          <dl className="hero__meta">
            <div>
              <dt>Today</dt>
              <dd>
                {formatHours(hours)}{" "}
                <span
                  className="status-open"
                  style={open ? undefined : { color: "var(--mut-2)" }}
                >
                  {open ? "• Open" : "• Closed"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>Bothasig, Cape Town</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd className="price">R{formatPrice(getCheapestPlanPrice())}/mo</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Training programmes</p>
              <h2>
                Our
                <br />
                classes
              </h2>
            </div>
            <Link className="pill-link" href="/classes">
              View all &rarr;
            </Link>
          </div>

          <div className="scroller">
            {classes.slice(0, 3).map((gymClass) => (
              <ClassCard
                key={gymClass.id}
                gymClass={gymClass}
                showBook={false}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Expert coaching</p>
              <h2>
                Meet our
                <br />
                coaches
              </h2>
            </div>
            <Link className="pill-link" href="/coaches">
              View all &rarr;
            </Link>
          </div>

          <div className="scroller">
            {coaches.slice(0, 3).map((coach) => (
              <CoachCard key={coach.id} coach={coach} />
            ))}
          </div>
        </div>
      </section>

      <section className="stats">
        <div>
          <b>367+</b>
          <span>Active members</span>
        </div>
        <div>
          <b>{coaches.length}</b>
          <span>Expert coaches</span>
        </div>
        <div>
          <b>{getTimetable().length}+</b>
          <span>Weekly classes</span>
        </div>
        <div>
          <b>67+</b>
          <span>Amateur champions</span>
        </div>
        <div>
          <b>7</b>
          <span>Years operating</span>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Pricing</p>
              <h2>
                Choose
                <br />
                your plan
              </h2>
            </div>
            <Link className="pill-link" href="/memberships">
              Membership page &rarr;
            </Link>
          </div>

          <div className="plans">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Reviews</p>
            <h2>What members say</h2>
          </div>

          <div className="grid grid--2">
            {reviews.map((review) => (
              <figure className="quote reveal" key={review.id}>
                <p
                  className="stars"
                  aria-label={`${review.rating} out of 5 stars`}
                >
                  {"★".repeat(review.rating)}
                </p>
                <blockquote>
                  <p>{review.body}</p>
                </blockquote>
                <figcaption>
                  <span className="av" aria-hidden="true">
                    {initials(review.memberName)}
                  </span>
                  <span>
                    <b>{review.memberName}</b>
                    <time dateTime={review.postedOn}>
                      {timeAgo(review.postedOn)}
                    </time>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">The facility</p>
            <h2>Inside PFC</h2>
            <p className="lead">
              Two full rings, a dedicated bag floor, mat space for grappling and
              a complete strength area.
            </p>
          </div>

          <div className="gallery">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Image
                key={n}
                src={`/images/gallery-${n}.jpg`}
                alt={`Inside the PFC facility, view ${n}`}
                width={900}
                height={900}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <Image
          src="/images/cta-ring.jpg"
          alt=""
          aria-hidden="true"
          width={1200}
          height={525}
        />
        <div className="wrap">
          <h2>
            Your first session
            <br />
            is on us
          </h2>
          <p className="lead" style={{ marginInline: "auto" }}>
            Come in, meet the coaches and try a class before you commit to
            anything.
          </p>
          <Link className="btn btn--red" href="/contact">
            Book a free trial
          </Link>
        </div>
      </section>

      <StickyCta />
    </>
  );
}
