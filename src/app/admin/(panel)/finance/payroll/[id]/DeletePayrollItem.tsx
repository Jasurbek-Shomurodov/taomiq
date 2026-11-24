"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { deleteSalaryEvent, deleteSalaryRate } from "@/lib/admin/finance/actions";

/**
 * The bin beside a payment, bonus, fine or absence (`item="event"`), or beside a rate (`item="rate"`): asks first,
 * naming what goes, then deletes it. On success the page is refreshed and the row goes; only a failure stays here.
 */
export function DeletePayrollItem({
  id,
  item,
  summary,
  locale,
}: {
  id: string;
  item: "event" | "rate";
  summary: string;
  locale: Locale;
}) {
  const [state, remove, removing] = useActionState<FormState, FormData>(
    item === "event" ? deleteSalaryEvent : deleteSalaryRate,
    {},
  );
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;

  return (
    <div className="grid justify-items-end gap-1">
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <ConfirmDialog
          trigger={
            <>
              <Trash2 aria-hidden="true" />
              <span className="sr-only">{p.deleteAria(summary)}</span>
            </>
          }
          triggerClassName="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm adm-btn-icon"
          disabled={removing}
          title={item === "event" ? p.deleteTitle : p.rateDeleteTitle}
          description={<span data-ph-mask>{item === "event" ? p.deleteText(summary) : p.rateDeleteText(summary)}</span>}
          confirmLabel={p.delete}
          pendingLabel={p.deleting}
          cancelLabel={t.common.cancel}
          destructive
          pending={removing}
        />
      </form>
      {!removing && state.error && (
        <p role="alert" className="max-w-56 text-right text-[13px] font-medium text-adm-negative">
          {state.error}
        </p>
      )}
    </div>
  );
}
