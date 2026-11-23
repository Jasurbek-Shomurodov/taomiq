"use client";

import { useId, useRef, useState } from "react";
import type { AdminDictionary } from "@/i18n/admin";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { translit } from "@/lib/translit";

/**
 * A Cyrillic Uzbek text field next to its Latin sibling. "Fill from Latin" converts the Latin field's
 * current value with the same translit() the site uses as a fallback; staff then correct what the
 * converter gets wrong (Russian loanwords, names). Empty is allowed: the site converts the Latin text.
 */
export function CyrillicField({
  name,
  latinName,
  label,
  defaultValue,
  rows,
  t,
}: {
  /** Form field name, e.g. "name_uzc". */
  name: string;
  /** Name of the Latin field in the same form, e.g. "name_uz". */
  latinName: string;
  label: string;
  defaultValue: string;
  /** Rows for a textarea; a single-line input when omitted. */
  rows?: number;
  t: AdminDictionary["cyrillic"];
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue);

  /** The Latin field's current value, converted; null when the form has no such field. */
  function converted(): string | null {
    const latin = rootRef.current?.closest("form")?.elements.namedItem(latinName);
    if (!(latin instanceof HTMLInputElement || latin instanceof HTMLTextAreaElement)) return null;
    return translit(latin.value.trim());
  }

  // Ask only when filling would overwrite different, non-empty Cyrillic text.
  function wouldOverwrite() {
    const next = converted();
    return next !== null && value.trim() !== "" && value !== next;
  }

  function fill() {
    const next = converted();
    if (next !== null) setValue(next);
  }

  return (
    <div ref={rootRef} className="grid content-start gap-1.5 text-sm font-semibold text-forest">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={id}>{label}</label>
        <ConfirmDialog
          trigger={t.fill}
          triggerClassName="cursor-pointer text-xs font-semibold text-forest underline underline-offset-4 hover:text-graphite"
          title={t.replaceTitle}
          description={t.replaceText}
          confirmLabel={t.replace}
          cancelLabel={t.keep}
          shouldAsk={wouldOverwrite}
          onConfirm={fill}
        />
      </div>
      {rows ? (
        <textarea
          id={id} name={name} rows={rows} value={value} lang="uz-Cyrl"
          onChange={(e) => setValue(e.target.value)} className="field font-normal"
        />
      ) : (
        <input
          id={id} name={name} value={value} lang="uz-Cyrl"
          onChange={(e) => setValue(e.target.value)} className="field font-normal"
        />
      )}
      <span className="text-xs font-normal text-muted">{t.emptyHint}</span>
    </div>
  );
}
