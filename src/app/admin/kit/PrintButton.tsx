"use client";

import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Locale } from "@/i18n/config";
import { formatDateTime } from "@/lib/admin/orders";

/** Opens the browser's print dialog. The page's print styles (admin.css, "Print") make the sheet. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="adm-btn adm-btn-outline adm-no-print">
      <Printer aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * The time on a printed sheet. Starts as the render time and is set to the moment of printing just before the
 * browser lays out the print (the DOM is written directly: a state update could land after the snapshot).
 */
export function PrintTime({ initial, locale }: { initial: string; locale: Locale }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = formatDateTime(new Date().toISOString(), locale);
    };
    window.addEventListener("beforeprint", update);
    return () => window.removeEventListener("beforeprint", update);
  }, [locale]);
  return (
    <span ref={ref} suppressHydrationWarning>
      {initial}
    </span>
  );
}
