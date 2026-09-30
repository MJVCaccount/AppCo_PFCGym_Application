"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Fades sections in as they scroll into view.
 *
 * It tags <html> with `js-reveal` first — the stylesheet only hides `.reveal`
 * elements under that class, so with JavaScript off nothing is ever hidden.
 * Anyone who has asked their system to reduce motion is left alone entirely.
 */
export default function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduced || !("IntersectionObserver" in window)) return;

    const root = document.documentElement;
    root.classList.add("js-reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -60px 0px" },
    );

    const targets = document.querySelectorAll(".reveal:not(.is-visible)");
    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
