"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import type { FormState } from "@/lib/admin/actions";
import { deleteFinanceEntry } from "@/lib/admin/finance/actions";

/**
 * The bin beside a record: asks first, naming the record (category, amount, date), then deletes it. On success the
 * page is refreshed and the row goes; only a failure stays here, under the button.
 */
export function DeleteEntry({ id, summary, locale }: { id: string; summary: string; locale: Locale }) {
  const [state, remove, removing] = useActionState<FormState, FormData>(deleteFinanceEntry, {});
  const t = getAdminDictionary(locale);
  const r = t.finance.records;

  return (
    <div className="grid justify-items-end gap-1">
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <ConfirmDialog
          trigger={
            <>
              <Trash2 aria-hidden="true" />
              <span className="sr-only">{r.deleteAria(summary)}</span>
            </>
          }
          triggerClassName="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm adm-btn-icon"
          disabled={removing}
          title={r.deleteTitle}
          description={<span data-ph-mask>{r.deleteText(summary)}</span>}
          confirmLabel={r.delete}
          pendingLabel={r.deleting}
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
