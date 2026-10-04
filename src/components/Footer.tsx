import Link from "next/link";

import { getOpeningHours } from "@/lib/repositories/hoursRepository";
import { DAY_NAMES, formatHours } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/classes", label: "Classes" },
  { href: "/coaches", label: "Coaches" },
  { href: "/memberships", label: "Memberships" },
  { href: "/timetable", label: "Timetable" },
  { href: "/events", label: "Events" },
  { href: "/contact", label: "Contact" },
];

export default async function Footer() {
  const hours = await getOpeningHours();

  return (
    <footer className="footer">
      <div className="wrap">
        <Link
          className="logo"
          href="/"
          aria-label="PFC home"
          style={{ marginBottom: 22 }}
        >
          <span>PFC</span>
        </Link>

        <div className="footer__cols">
          {/* All three open by default: on desktop the CSS hides the
              expand marker, so a closed one looks like an empty heading. */}
          <details open>
            <summary>
              <h4>Navigation</h4>
            </summary>
            <ul>
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </details>

          <details open>
            <summary>
              <h4>Opening hours</h4>
            </summary>
            <dl className="hours">
              {hours.map((h) => (
                <div key={h.day} style={{ display: "contents" }}>
                  <dt>{DAY_NAMES[h.day].slice(0, 3)}</dt>
                  <dd>{formatHours(h)}</dd>
                </div>
              ))}
            </dl>
          </details>

          <details open>
            <summary>
              <h4>Find us</h4>
            </summary>
            <ul className="contact-list">
              <li>
                <span className="ico" aria-hidden="true">
                  &#9679;
                </span>
                Bothasig, Cape Town, Western Cape
              </li>
              <li>
                <span className="ico" aria-hidden="true">
                  &#9679;
                </span>
                <a href="tel:+27826709027">+27 82 670 9027</a>
              </li>
              <li>
                <span className="ico" aria-hidden="true">
                  &#9679;
                </span>
                <a href="mailto:PFCgroup@gmail.co.za">PFCgroup@gmail.co.za</a>
              </li>
            </ul>
          </details>
        </div>

        <div className="footer__legal">
          <p>
            &copy; {new Date().getFullYear()} Professional Fighting
            Championship. All rights reserved.
          </p>
          <nav aria-label="Legal">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Cookie Policy</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
