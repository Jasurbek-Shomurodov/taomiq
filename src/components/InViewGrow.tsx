"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Bars inside (.grow-x) grow from zero once this block scrolls into view. Without JavaScript, with
 * reduced motion or without IntersectionObserver they are simply drawn at full length: the empty
 * state ("armed") is only ever set from here.
 */
export function InViewGrow({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.grow = "armed";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.dataset.grow = "in";
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      delete el.dataset.grow;
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
