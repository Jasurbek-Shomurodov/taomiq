"use client";

import { useActionState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { approveAccess, declineAccess, removeStaff, type FormState } from "@/lib/admin/actions";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { Notice } from "../../kit/Notice";

// On success the page refreshes and the row moves or goes away, so only failures are shown here.
function Failure({ state }: { state: FormState }) {
  return state.error ? <Notice tone="negative">{state.error}</Notice> : null;
}

/**
 * Approve (asks first, naming the email) and, for a waiting request, Decline (no question: a declined request can
 * still be approved later). Each button shows its own busy state; both stay disabled while either runs.
 */
export function RequestActions({
  userId,
  email,
  waiting,
  locale,
}: {
  userId: string;
  email: string;
  waiting: boolean;
  locale: Locale;
}) {
  const [approveState, approve, approving] = useActionState<FormState, FormData>(approveAccess, {});
  const [declineState, decline, declining] = useActionState<FormState, FormData>(declineAccess, {});
  const t = getAdminDictionary(locale);
  const busy = approving || declining;

  return (
    <div className="grid gap-2 sm:justify-items-end">
      <div className="flex flex-wrap gap-2">
        <form action={approve}>
          <input type="hidden" name="user_id" value={userId} />
          <ConfirmDialog
            trigger={approving ? t.team.approving : t.team.approve}
            triggerClassName="adm-btn adm-btn-primary adm-btn-sm"
            disabled={busy}
            title={t.team.approveTitle}
            description={<span data-ph-mask>{t.team.approveText(email)}</span>}
            confirmLabel={t.team.approve}
            pendingLabel={t.team.approving}
            cancelLabel={t.common.cancel}
            pending={approving}
          />
        </form>
        {waiting && (
          <form action={decline}>
            <input type="hidden" name="user_id" value={userId} />
            <button
              type="submit"
              disabled={busy}
              aria-busy={declining || undefined}
              className="adm-btn adm-btn-outline adm-btn-sm"
            >
              {declining ? t.team.declining : t.team.decline}
            </button>
          </form>
        )}
      </div>
      <div aria-live="polite">
        <Failure state={approveState} />
        <Failure state={declineState} />
      </div>
    </div>
  );
}

/** Remove an admin from the team, after a question that names the email. Owners never get this button. */
export function RemoveAction({ userId, email, locale }: { userId: string; email: string; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeStaff, {});
  const t = getAdminDictionary(locale);

  return (
    <div className="grid gap-2 sm:justify-items-end">
      <form action={action}>
        <input type="hidden" name="user_id" value={userId} />
        <ConfirmDialog
          trigger={pending ? t.team.removing : t.team.remove}
          triggerClassName="adm-btn adm-btn-outline adm-btn-danger adm-btn-sm"
          disabled={pending}
          title={t.team.removeTitle}
          description={<span data-ph-mask>{t.team.removeText(email)}</span>}
          confirmLabel={t.team.remove}
          pendingLabel={t.team.removing}
          cancelLabel={t.common.cancel}
          destructive
          pending={pending}
        />
      </form>
      <div aria-live="polite">
        <Failure state={state} />
      </div>
    </div>
  );
}
