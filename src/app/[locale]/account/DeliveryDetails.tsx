"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { removeMyDelivery, saveMyDelivery, type DeliveryState } from "@/lib/account/delivery-actions";
import { LIMITS } from "@/lib/order/rules";

type T = Dictionary["account"]["delivery"];

/** The saved details as the card shows them; "" for a field that is not saved. */
export type DeliveryView = { address: string; window: string; note: string };

/**
 * The "Delivery details" card's body (docs/plans/saved-address-repeat-order.md, slice 3): the saved address, delivery
 * time and courier note, with Change and Remove; nothing saved yet, an Add button. The parent section carries
 * data-ph-mask, so session replays never show the address.
 */
export function DeliveryDetails({
  locale,
  saved,
  windows,
  t,
}: {
  locale: Locale;
  saved: DeliveryView | null;
  windows: string[];
  t: T;
}) {
  const [editing, setEditing] = useState(false);
  // The edit form's fields are controlled: React resets an action form's uncontrolled fields after every answer, and a
  // refused save must keep what the customer typed.
  const [draft, setDraft] = useState<DeliveryView>({ address: "", window: "", note: "" });
  const [saveState, saveAction, saving] = useActionState<DeliveryState, FormData>(saveMyDelivery, {});
  const [removeState, removeAction, removing] = useActionState<DeliveryState, FormData>(removeMyDelivery, {});
  // The newest answer of either form is the one shown.
  const [last, setLast] = useState<"save" | "remove" | null>(null);
  const state = last === "save" ? saveState : last === "remove" ? removeState : {};
  const startEditing = () => {
    setLast(null);
    setDraft({
      address: saved?.address ?? "",
      window: saved?.window && windows.includes(saved.window) ? saved.window : "",
      note: saved?.note ?? "",
    });
    setEditing(true);
  };

  // A saved form closes: the page shows the new details (the action refreshes it).
  const [handled, setHandled] = useState(saveState);
  if (saveState !== handled) {
    setHandled(saveState);
    if (saveState.ok) setEditing(false);
  }

  const editButton = useRef<HTMLButtonElement>(null);
  const addressField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) addressField.current?.focus();
  }, [editing]);

  const status = (
    <p
      role={state.error ? "alert" : "status"}
      className={`text-sm ${state.error ? "font-semibold text-danger" : "text-muted"}`}
      data-delivery-status
    >
      {state.error ?? state.ok ?? ""}
    </p>
  );

  if (editing) {
    const invalid = (field: DeliveryState["field"]) => (state.error && state.field === field ? true : undefined);
    return (
      <form
        action={saveAction}
        onSubmit={() => setLast("save")}
        // The server checks and answers in the customer's language; the browser's own messages are not used.
        noValidate
        className="mt-5 grid gap-5"
        data-delivery-form
      >
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="delivery-address" className="label text-muted">
            {t.address}
          </label>
          <textarea
            ref={addressField}
            id="delivery-address"
            name="address"
            required
            rows={3}
            minLength={LIMITS.address.min}
            maxLength={LIMITS.address.max}
            autoComplete="street-address"
            value={draft.address}
            onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
            aria-invalid={invalid("address")}
            className="field mt-2 resize-y"
            data-ph-mask
          />
        </div>
        <div>
          <label htmlFor="delivery-window" className="label text-muted">
            {t.window}
          </label>
          <select
            id="delivery-window"
            name="window"
            value={draft.window}
            onChange={(e) => setDraft((prev) => ({ ...prev, window: e.target.value }))}
            aria-invalid={invalid("window")}
            className="field mt-2 min-h-12 tabular-nums"
          >
            <option value="">{t.anyWindow}</option>
            {windows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="delivery-note" className="label text-muted">
            {t.note}
          </label>
          <input
            id="delivery-note"
            name="note"
            maxLength={LIMITS.comment}
            value={draft.note}
            onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
            aria-invalid={invalid("note")}
            className="field mt-2"
          />
        </div>
        {status}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={saving} className="btn btn-forest min-h-12 disabled:opacity-60">
            {saving ? t.saving : t.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setLast(null);
              requestAnimationFrame(() => editButton.current?.focus());
            }}
            className="btn btn-outline min-h-12 text-forest"
          >
            {t.cancel}
          </button>
        </div>
      </form>
    );
  }

  if (!saved) {
    return (
      <div className="mt-4 grid gap-4">
        <p className="text-muted">{t.empty}</p>
        {status}
        <button
          ref={editButton}
          type="button"
          onClick={startEditing}
          className="btn btn-outline min-h-12 w-full text-forest sm:w-auto sm:justify-self-start"
        >
          {t.add}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4">
      <dl className="grid gap-4">
        {saved.address && (
          <div className="grid gap-1">
            <dt className="label text-muted">{t.address}</dt>
            <dd className="whitespace-pre-line break-words text-graphite" data-ph-mask data-delivery-address>
              {saved.address}
            </dd>
          </div>
        )}
        {saved.window && (
          <div className="grid gap-1">
            <dt className="label text-muted">{t.window}</dt>
            <dd className="font-semibold text-graphite tabular-nums" data-delivery-window>
              {saved.window}
            </dd>
          </div>
        )}
        {saved.note && (
          <div className="grid gap-1">
            <dt className="label text-muted">{t.note}</dt>
            <dd className="break-words text-graphite" data-ph-mask>
              {saved.note}
            </dd>
          </div>
        )}
      </dl>
      <p className="text-sm text-muted">{t.hint}</p>
      {status}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          ref={editButton}
          type="button"
          onClick={startEditing}
          className="btn btn-outline min-h-12 text-forest"
        >
          {t.edit}
        </button>
        <form action={removeAction} onSubmit={() => setLast("remove")}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            disabled={removing}
            className="inline-flex min-h-12 w-full items-center justify-center px-3 text-sm font-semibold text-danger underline underline-offset-4 disabled:opacity-60 sm:w-auto"
          >
            {removing ? t.removing : t.remove}
          </button>
        </form>
      </div>
    </div>
  );
}
