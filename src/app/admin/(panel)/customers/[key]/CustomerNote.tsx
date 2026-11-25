"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { saveCustomerNote } from "@/lib/admin/customer-actions";
import { CUSTOMER_NOTE_MAX } from "@/lib/admin/customers";
import { FormMessage } from "../../finance/payroll/FormMessage";

/**
 * The staff note on a customer page. It saves on its own, like a Settings control: its own Save, off until the text
 * changed, a spinner while it saves, then "saved" or the reason it failed beside it; an edit clears that line. The
 * form posts the customer's key and the phone the page showed (in the POST body, never the address): the database
 * refuses the save when that key now belongs to another phone (lib/admin/customer-actions.ts).
 */
export function CustomerNote({
  customerKey,
  phone,
  note,
  updatedLine,
  locale,
}: {
  customerKey: string;
  /** The phone this page was rendered for ("+998XXXXXXXXX"). */
  phone: string;
  note: string;
  /** Who saved it last and when, already worded; null when the note was never saved. */
  updatedLine: string | null;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const c = t.customers;
  const id = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveCustomerNote, {});
  // The phone this note was opened for, kept from the first render: a later server render cannot swap it under the
  // typed text, so the database's key-and-phone check still refuses a key that moved to another phone.
  const [loadedPhone] = useState(phone);
  // Controlled, so the text survives React's form reset when saving fails.
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(note);
  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) setSaved(value.trim());
  }
  const changed = value.trim() !== saved;

  return (
    <form action={action} className="adm-panel">
      <input type="hidden" name="key" value={customerKey} />
      <input type="hidden" name="phone" value={loadedPhone} />
      <label htmlFor={id} className="adm-heading block">
        {c.note}
      </label>
      <textarea
        id={id}
        name="note"
        rows={5}
        maxLength={CUSTOMER_NOTE_MAX}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (message.ok || message.error) setMessage({});
        }}
        placeholder={c.notePlaceholder}
        disabled={pending}
        className="adm-input mt-3"
        data-ph-mask
      />
      <p className="adm-caption mt-1">{c.noteHidden}</p>
      {updatedLine && <p className="adm-caption mt-1 tabular-nums">{updatedLine}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !changed}
          aria-busy={pending || undefined}
          className="adm-btn adm-btn-outline"
        >
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? t.common.saving : t.common.save}
        </button>
        <FormMessage message={message} pending={pending} />
      </div>
    </form>
  );
}
