"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { isMemberRole, type SessionUser } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/classes", label: "Classes" },
  { href: "/coaches", label: "Coaches" },
  { href: "/memberships", label: "Memberships" },
  { href: "/timetable", label: "Timetable" },
  { href: "/contact", label: "Contact" },
] as const;

interface Props {
  session: SessionUser | null;
  todayHours: string;
  logoutAction: () => Promise<void>;
}

export default function SiteNav({ session, todayHours, logoutAction }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const canBook = session !== null && isMemberRole(session.role);

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Close the overlay whenever the route changes, so tapping a link does not
  // leave it covering the page it navigated to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the overlay is open it behaves as a real modal: the page behind it
  // cannot scroll, Escape closes it, and Tab cycles inside it rather than
  // wandering into the hidden page.
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        burgerRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <header className="header">
        <div className="header__inner">
          <Link className="logo" href="/" aria-label="PFC home">
            <span>PFC</span>
          </Link>

          <nav className="nav" aria-label="Main navigation">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="header__actions">
            {session ? (
              <>
                {canBook && (
                  <Link className="header__login" href="/bookings">
                    My bookings
                  </Link>
                )}
                <Link className="header__login" href="/dashboard">
                  {session.fullName}
                </Link>
                <form action={logoutAction}>
                  <button className="btn btn--line btn--sm" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link className="header__login" href="/login">
                  Login
                </Link>
                <Link className="btn btn--red btn--sm" href="/memberships">
                  Join now
                </Link>
              </>
            )}

            <button
              ref={burgerRef}
              className="burger"
              type="button"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="navpanel"
              onClick={() => setOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <div
        ref={panelRef}
        className={`navpanel${open ? " is-open" : ""}`}
        id="navpanel"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="navpanel__top">
          <button
            ref={closeRef}
            className="navpanel__close"
            type="button"
            aria-label="Close menu"
            onClick={() => {
              setOpen(false);
              burgerRef.current?.focus();
            }}
          >
            &times;
          </button>
        </div>

        <nav className="navpanel__list" aria-label="Mobile navigation">
          {NAV.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? "page" : undefined}
            >
              {item.label}
              <span>{String(index + 1).padStart(2, "0")}</span>
            </Link>
          ))}
        </nav>

        <div className="navpanel__cta">
          {session ? (
            <>
              <Link className="btn btn--red" href="/dashboard">
                My dashboard
              </Link>
              {canBook && (
                <Link className="btn btn--line" href="/bookings">
                  My bookings
                </Link>
              )}
              <form action={logoutAction}>
                <button className="btn btn--line btn--block" type="submit">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link className="btn btn--red" href="/memberships">
                Join now
              </Link>
              <Link className="btn btn--line" href="/login">
                Log in
              </Link>
            </>
          )}
        </div>

        <p className="navpanel__meta">
          Open today {todayHours}
          <br />
          +27 82 670 9027
        </p>
      </div>
    </>
  );
}
