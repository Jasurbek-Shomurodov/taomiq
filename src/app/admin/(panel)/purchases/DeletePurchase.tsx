"use client";

import { useActionState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import type { FormState } from "@/lib/admin/actions";
import { deletePurchase } from "@/lib/admin/purchase-actions";

/**
 * "Delete receipt" under the receipt: asks first, naming the receipt and saying that its expense goes with it, then
 * deletes both. On success the History opens; only a failure stays here.
 */
export function DeletePurchase({
  id,
  loadedAt,
  summary,
  locale,
}: {
  id: string;
  loadedAt: string;
  summary: string;
  locale: Locale;
}) {
  const [state, remove, removing] = useActionState<FormState, FormData>(deletePurchase, {});
  const t = getAdminDictionary(locale);
  const tp = t.purchases;

  return (
    <form action={remove} className="grid justify-items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="loaded_at" value={loadedAt} />
      <ConfirmDialog
        trigger={tp.delete}
        triggerClassName="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm -ml-3"
        disabled={removing}
        title={tp.deleteTitle}
        description={tp.deleteText(summary)}
        confirmLabel={tp.deleteButton}
        pendingLabel={tp.deleting}
        cancelLabel={t.common.cancel}
        destructive
        pending={removing}
      />
      {!removing && state.error && (
        <p role="alert" className="text-sm font-medium text-adm-negative">
          {state.error}
        </p>
      )}
    </form>
  );
}
