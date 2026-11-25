"use client";

import { CheckCheck, LoaderCircle, Minus, Plus } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { confirmEquipmentCount, saveEquipmentCount } from "@/lib/admin/equipment-actions";
import { EQUIPMENT_LIMITS, clampCount, readCount } from "@/lib/admin/equipment";
import { FormMessage } from "../finance/payroll/FormMessage";

/**
 * The quick count of one item: −, the number, +, and its own Save, off until the number changed and is valid. It
 * saves on its own, like a Settings control: a spinner while it saves, then "saved" or the reason it failed beside it;
 * an edit clears that line. The form posts the count it showed (`loaded`): when someone else counted in between,
 * nothing is written and the page refreshes with their number. Who counted and when is stamped by the database.
 *
 * While the number is unchanged, a second button "Counted, still N" records a recount that found the same number: the
 * database stamps who and when without changing the count ("counted" means last checked).
 */
export function CountControl({
  id,
  name,
  count,
  locale,
}: {
  id: string;
  /** The item's name, for the input's accessible label. */
  name: string;
  count: number;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  const inputId = useId();
  const [state, action, savePending] = useActionState<FormState, FormData>(saveEquipmentCount, {});
  const [confirmState, confirmAction, confirmPending] = useActionState<FormState, FormData>(confirmEquipmentCount, {});
  const pending = savePending || confirmPending;
  const [value, setValue] = useState(String(count));
  const [saved, setSaved] = useState(count);
  const [message, setMessage] = useState<FormState>({});
  const [seenState, setSeenState] = useState(state);
  const [seenConfirm, setSeenConfirm] = useState(confirmState);
  const [seenCount, setSeenCount] = useState(count);
  if (confirmState !== seenConfirm) {
    setSeenConfirm(confirmState);
    setMessage(confirmState);
  }
  if (state !== seenState) {
    setSeenState(state);
    setMessage(state);
    if (state.ok) {
      const next = readCount(value);
      if (next !== null) setSaved(next);
    }
  }
  // A refresh brought a new count (this save, or someone else's): show it.
  if (count !== seenCount) {
    setSeenCount(count);
    setSaved(count);
    setValue(String(count));
  }

  const parsed = readCount(value);
  const changed = parsed !== null && parsed !== saved;
  const invalid = value.trim() !== "" && parsed === null;

  function set(next: string) {
    setValue(next);
    if (message.ok || message.error) setMessage({});
  }

  const step = (delta: number) => set(String(clampCount((parsed ?? saved) + delta)));

  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="loaded" value={saved} />
      <label htmlFor={inputId} className="sr-only">
        {te.countAria(name)}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={pending || (parsed ?? saved) <= 0}
            aria-label={te.decrease}
            aria-controls={inputId}
            className="adm-btn adm-btn-outline adm-btn-icon min-h-11 w-11 rounded-r-none shadow-none"
          >
            <Minus aria-hidden="true" />
          </button>
          <input
            id={inputId}
            name="count"
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            value={value}
            onChange={(event) => set(event.target.value)}
            disabled={pending}
            aria-invalid={invalid || undefined}
            className="adm-input -mx-px w-20 rounded-none text-center font-semibold tabular-nums"
          />
          <button
            type="button"
            onClick={() => step(1)}
            disabled={pending || (parsed ?? saved) >= EQUIPMENT_LIMITS.countMax}
            aria-label={te.increase}
            aria-controls={inputId}
            className="adm-btn adm-btn-outline adm-btn-icon min-h-11 w-11 rounded-l-none shadow-none"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {changed || invalid ? (
          <button
            type="submit"
            disabled={pending || !changed}
            aria-busy={savePending || undefined}
            className="adm-btn adm-btn-outline"
          >
            {savePending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {savePending ? t.common.saving : t.common.save}
          </button>
        ) : (
          // The number is the saved one: record that a recount found it (who and when), the count stays.
          <button
            type="submit"
            formAction={confirmAction}
            disabled={pending}
            aria-busy={confirmPending || undefined}
            className="adm-btn adm-btn-outline"
          >
            {confirmPending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <CheckCheck aria-hidden="true" />
            )}
            {confirmPending ? t.common.saving : te.confirm(saved)}
          </button>
        )}
      </div>
      {invalid ? (
        <span role="alert" className="text-[13px] font-medium text-adm-negative">
          {te.errors.countInvalid(EQUIPMENT_LIMITS.countMax)}
        </span>
      ) : (
        <FormMessage message={message} pending={pending} />
      )}
    </form>
  );
}
