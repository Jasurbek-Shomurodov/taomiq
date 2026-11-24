"use client";

import { useActionState, useId, useState } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { approveAccess, changeStaffRole, declineAccess, removeStaff, type FormState } from "@/lib/admin/actions";
import { GRANTABLE_ROLES, type GrantableRole } from "@/lib/admin/roles";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { Notice } from "../../kit/Notice";

// On success the page refreshes and the row moves or goes away, so only failures are shown here.
function Failure({ state }: { state: FormState }) {
  return state.error ? <Notice tone="negative">{state.error}</Notice> : null;
}

/**
 * The roles the owner can give, one row each with what that role sees. Rendered inside the confirmation dialog,
 * which sits outside the form: the value lives in the caller's state and reaches the form as a hidden field.
 * Each row is a 44 px target on a phone.
 */
function RoleChoice({
  value,
  onChange,
  disabled,
  t,
}: {
  value: GrantableRole | null;
  onChange: (role: GrantableRole) => void;
  disabled: boolean;
  t: AdminDictionary;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold text-adm-text">{t.team.role}</legend>
      {GRANTABLE_ROLES.map((role) => (
        <label
          key={role}
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-adm-btn border border-adm-border px-3 py-2.5 has-checked:border-adm-accent has-checked:bg-adm-accent-tint has-disabled:cursor-default"
        >
          <input
            type="radio"
            name={name}
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
            className="mt-0.5 size-4 shrink-0 accent-adm-accent"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-adm-text">{t.roles[role]}</span>
            <span className="adm-caption">{t.team.roleInfo[role]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Approve (asks first, naming the email, with the role to give: administrator by default) and, for a waiting
 * request, Decline (no question: a declined request can still be approved later). Each button shows its own busy
 * state; both stay disabled while either runs.
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
  const [role, setRole] = useState<GrantableRole>(GRANTABLE_ROLES[0]);
  const t = getAdminDictionary(locale);
  const busy = approving || declining;

  return (
    <div className="grid gap-2 sm:justify-items-end">
      <div className="flex flex-wrap gap-2">
        <form action={approve}>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="role" value={role} />
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
            onOpen={() => setRole(GRANTABLE_ROLES[0])}
          >
            <RoleChoice value={role} onChange={setRole} disabled={approving} t={t} />
          </ConfirmDialog>
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

/**
 * A member's controls, for anyone but an owner: Change role (a question that names the email, with the roles to
 * pick from; the current one is preselected and confirming needs a different one) and Remove (a question that names
 * the email). Owners never get these buttons, and the database refuses both for an owner anyway.
 */
export function MemberActions({
  userId,
  email,
  role,
  locale,
}: {
  userId: string;
  email: string;
  /** The member's role now; null when it is not one the owner can give (shown, but not preselected). */
  role: GrantableRole | null;
  locale: Locale;
}) {
  const [roleState, changeRole, changing] = useActionState<FormState, FormData>(changeStaffRole, {});
  const [removeState, remove, removing] = useActionState<FormState, FormData>(removeStaff, {});
  const [nextRole, setNextRole] = useState<GrantableRole | null>(role);
  const t = getAdminDictionary(locale);
  const busy = changing || removing;

  return (
    <div className="grid gap-2 sm:justify-items-end">
      <div className="flex flex-wrap gap-2">
        <form action={changeRole}>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="role" value={nextRole ?? ""} />
          <ConfirmDialog
            trigger={changing ? t.team.changingRole : t.team.changeRole}
            triggerClassName="adm-btn adm-btn-outline adm-btn-sm"
            disabled={busy}
            title={t.team.changeRoleTitle}
            description={<span data-ph-mask>{t.team.changeRoleText(email)}</span>}
            confirmLabel={t.team.changeRole}
            pendingLabel={t.team.changingRole}
            cancelLabel={t.common.cancel}
            pending={changing}
            onOpen={() => setNextRole(role)}
            confirmDisabled={nextRole === null || nextRole === role}
          >
            <RoleChoice value={nextRole} onChange={setNextRole} disabled={changing} t={t} />
          </ConfirmDialog>
        </form>
        <form action={remove}>
          <input type="hidden" name="user_id" value={userId} />
          <ConfirmDialog
            trigger={removing ? t.team.removing : t.team.remove}
            triggerClassName="adm-btn adm-btn-outline adm-btn-danger adm-btn-sm"
            disabled={busy}
            title={t.team.removeTitle}
            description={<span data-ph-mask>{t.team.removeText(email)}</span>}
            confirmLabel={t.team.remove}
            pendingLabel={t.team.removing}
            cancelLabel={t.common.cancel}
            destructive
            pending={removing}
          />
        </form>
      </div>
      <div aria-live="polite">
        <Failure state={roleState} />
        <Failure state={removeState} />
      </div>
    </div>
  );
}
