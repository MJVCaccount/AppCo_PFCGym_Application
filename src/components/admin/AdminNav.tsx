"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/coaches", label: "Coaches" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/fighters", label: "Fighters" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/audit", label: "Audit" },
] as const;

/** The admin sidebar links, with the section being viewed highlighted. */
export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Admin sections">
      <Link className="btn btn--grey btn--sm" href="/dashboard">
        Overview
      </Link>
      {SECTIONS.map((section) => {
        const current = pathname.startsWith(section.href);

        return (
          <Link
            key={section.href}
            className={`btn btn--sm ${current ? "btn--red" : "btn--grey"}`}
            href={section.href}
            aria-current={current ? "page" : undefined}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
