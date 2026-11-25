"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { quickAddIngredient } from "@/lib/admin/ingredient-actions";
import {
  INGREDIENT_UNITS,
  hasIngredientErrors,
  type Ingredient,
  type IngredientErrors,
  type IngredientUnit,
} from "@/lib/admin/ingredients";
import { savePurchase, type PurchaseFormState } from "@/lib/admin/purchase-actions";
import {
  PAYMENT_METHODS,
  PURCHASE_BACKDATE_DAYS,
  PURCHASE_LIMITS,
  checkPurchase,
  formatQuantity,
  hasPurchaseErrors,
  parseAmount,
  parseQuantity,
  priceDiff,
  purchaseDayRange,
  unitCost,
  type Buyer,
  type LineProblem,
  type PaymentMethod,
  type Purchase,
  type PurchaseErrors,
} from "@/lib/admin/purchases";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { addDays } from "@/lib/order/rules";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";
import { ingredientProblem } from "../ingredients/IngredientForm";
import { formIngredient, type FormIngredient } from "./form-ingredient";
import { IngredientPicker } from "./IngredientPicker";

/*
 * The purchase form (docs/plans/zarkebab-feature-port.md, slice 6): a new market receipt (/purchases, tab New) or the
 * edit of one (/purchases/[id]). Day, buyer, payment method, note, then lines of ingredient, quantity and amount
 * paid, with the unit cost and its difference from the usual price as you type, and the running total. Save sits in
 * the top bar and stays disabled until the receipt is valid (and, for an edit, changed). The rules are
 * lib/admin/purchases.ts; the action and public.purchase_save check them again.
 */

const FORM_ID = "purchase-form";

type Line = {
  key: number;
  ingredientId: string;
  quantity: string;
  amount: string;
  /** The receipt's own snapshot for this ingredient (an edit): the unit and usual price of the day it was bought. */
  snapshot: { ingredientId: string; unit: IngredientUnit; usualPrice: number | null } | null;
};

/** "12,5" for a stored quantity, as a person would type it. */
function quantityInput(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : String(whole);
}

function serialize(state: { day: string; buyerId: string; method: string; note: string; lines: Line[] }): string {
  return JSON.stringify([
    state.day,
    state.buyerId,
    state.method,
    state.note.trim(),
    state.lines
      .filter((l) => l.ingredientId || l.quantity.trim() || l.amount.trim())
      .map((l) => [l.ingredientId, parseQuantity(l.quantity) ?? l.quantity.trim(), parseAmount(l.amount) ?? l.amount.trim()]),
  ]);
}

export function PurchaseForm({
  purchase,
  ingredients: initialIngredients,
  categories,
  buyers,
  today,
  lockedThrough,
  readOnly,
  locale,
}: {
  /** The receipt being edited; null for a new one. */
  purchase: Purchase | null;
  ingredients: FormIngredient[];
  categories: { id: string; name: string }[];
  /** Null when the list could not be read: the buyer cannot be changed then. */
  buyers: Buyer[] | null;
  /** Tashkent day, "YYYY-MM-DD". */
  today: string;
  /** The last day of the latest closed month, or null. */
  lockedThrough: string | null;
  /** A receipt in a closed month: shown, not editable. */
  readOnly: boolean;
  locale: Locale;
}) {
  // The save's idempotency key: made in the browser at the first send, kept for a repeated send (a double tap or a
  // retry after a lost answer saves one receipt), replaced only after a new receipt was saved. Never made on the
  // server, so a server render of the page can neither change it nor remount the form and lose what was typed.
  const requestIdRef = useRef<string | null>(null);
  const [state, action, pending] = useActionState<PurchaseFormState, FormData>(async (prev, form) => {
    requestIdRef.current ??= crypto.randomUUID();
    form.set("request_id", requestIdRef.current);
    const result = await savePurchase(prev, form);
    if (result.saved) requestIdRef.current = null;
    return result;
  }, {});
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const baseId = useId();

  const [ingredients, setIngredients] = useState(initialIngredients);
  const byId = new Map(ingredients.map((item) => [item.id, item]));

  const range = purchaseDayRange(today);
  // Never offer a day in a closed month.
  const earliest = lockedThrough && lockedThrough >= range.earliest ? addDays(lockedThrough, 1) : range.earliest;
  const [initial] = useState(() => {
    const lines: Line[] = purchase
      ? purchase.lines.map((line, index) => ({
          key: index,
          ingredientId: line.ingredient_id,
          quantity: quantityInput(line.milli),
          amount: String(line.amount),
          snapshot: { ingredientId: line.ingredient_id, unit: line.unit, usualPrice: line.usual_price },
        }))
      : [{ key: 0, ingredientId: "", quantity: "", amount: "", snapshot: null }];
    return {
      day: purchase?.day ?? today,
      buyerId: purchase?.buyer_id ?? "",
      method: (purchase?.payment_method ?? "cash") as PaymentMethod,
      note: purchase?.note ?? "",
      lines,
    };
  });
  const [day, setDay] = useState(initial.day);
  const [buyerId, setBuyerId] = useState(initial.buyerId);
  const [method, setMethod] = useState<PaymentMethod>(initial.method);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [nextKey, setNextKey] = useState(initial.lines.length);
  const [initialKey] = useState(() => serialize(initial));
  const [adding, setAdding] = useState<{ lineKey: number; typed: string } | null>(null);

  // Server-named problems are kept until the person edits again.
  const [server, setServer] = useState<PurchaseErrors | null>(null);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setServer(state.errors ?? null);
    if (state.saved) {
      // A new receipt was saved: the next one starts empty, on the same day, buyer and payment method.
      setLines([{ key: nextKey, ingredientId: "", quantity: "", amount: "", snapshot: null }]);
      setNextKey((n) => n + 1);
      setNote("");
      setAdding(null);
    }
  }

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.errors || state.saved) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  const dayAllowed = purchase !== null && day === purchase.day ? true : day >= earliest && day <= range.latest;
  const check = checkPurchase({ dayAllowed, method, note, lines });
  const changed = purchase === null || serialize({ day, buyerId, method, note, lines }) !== initialKey;
  const canSave = !readOnly && changed && !hasPurchaseErrors(check.errors) && !pending;

  function touch() {
    if (server) setServer(null);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    touch();
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, ingredientId: "", quantity: "", amount: "", snapshot: null }]);
    setNextKey((n) => n + 1);
  }

  function removeLine(key: number) {
    setLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next.length ? next : [{ key: nextKey, ingredientId: "", quantity: "", amount: "", snapshot: null }];
    });
    setNextKey((n) => n + 1);
    if (adding?.lineKey === key) setAdding(null);
    touch();
  }

  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const errors: PurchaseErrors = server ?? { form: [], lines: {} };
  const formError = (problem: PurchaseErrors["form"][number]) => errors.form.includes(problem);

  // Why Save is disabled, in one line (the first problem), once something has been entered.
  const blocking = (() => {
    if (readOnly || !changed) return null;
    const e = check.errors;
    if (e.form.includes("day")) return tp.formErrors.day(formatEntryDay(earliest, locale));
    if (e.form.includes("method")) return tp.formErrors.method;
    const first = Object.keys(e.lines).map(Number).sort((a, b) => a - b)[0];
    if (first !== undefined) {
      return `${tp.lineLabel(first + 1)}: ${tp.lineErrors[e.lines[first][0]]}`;
    }
    if (e.form.includes("lines")) return tp.formErrors.lines;
    if (e.form.includes("note")) return tp.formErrors.note;
    if (e.form.includes("total")) return tp.formErrors.total;
    return null;
  })();

  const button = (
    <button
      type="submit"
      form={FORM_ID}
      disabled={!canSave}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? tp.saving : purchase ? tp.saveChanges : tp.save}
    </button>
  );

  const buyerOptions = buyers ?? [];
  const keptBuyer =
    purchase?.buyer_id && !buyerOptions.some((b) => b.id === purchase.buyer_id)
      ? { id: purchase.buyer_id, name: purchase.buyer_name }
      : null;

  return (
    <>
      {!readOnly && <TopBarActions>{button}</TopBarActions>}
      <form
        id={FORM_ID}
        action={action}
        noValidate
        onSubmit={(event) => {
          if (!canSave) event.preventDefault();
        }}
        className="grid gap-5"
      >
        {purchase && <input type="hidden" name="id" value={purchase.id} />}
        {purchase && <input type="hidden" name="loaded_at" value={purchase.updated_at} />}
        {purchase && <input type="hidden" name="loaded_day" value={purchase.day} />}
        <input type="hidden" name="day" value={day} />
        <input type="hidden" name="buyer_id" value={buyerId} />
        <input type="hidden" name="payment_method" value={method} />
        <input type="hidden" name="note" value={note} />
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(
            lines.map((line) => ({ ingredient_id: line.ingredientId, quantity: line.quantity, amount: line.amount })),
          )}
        />

        <div ref={noticeRef} className="empty:hidden">
          {(state.error || (server && hasPurchaseErrors(server))) && (
            <Notice tone="negative">{state.error ?? tp.problems}</Notice>
          )}
          {state.saved && !pending && (
            <Notice tone="positive">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {tp.saved(sum(state.saved.total))}
                <Link href={`/purchases/${state.saved.id}`} className="font-semibold underline underline-offset-4">
                  {tp.savedOpen}
                </Link>
              </span>
            </Notice>
          )}
        </div>

        {!purchase && <p className="adm-muted">{tp.lead}</p>}
        <fieldset disabled={readOnly || pending} className="min-w-0">
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="adm-label">
                {tp.day}
                <input
                  type="date"
                  required
                  min={purchase && purchase.day < earliest ? purchase.day : earliest}
                  max={range.latest}
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    touch();
                  }}
                  aria-invalid={!dayAllowed || formError("day") || undefined}
                  className="adm-input font-normal tabular-nums"
                />
                <span className="adm-caption font-normal">
                  {purchase ? tp.dayKeptHint(PURCHASE_BACKDATE_DAYS) : tp.dayHint(PURCHASE_BACKDATE_DAYS)}
                </span>
              </label>

              <label className="adm-label">
                {tp.buyer}
                <select
                  value={buyerId}
                  onChange={(event) => {
                    setBuyerId(event.target.value);
                    touch();
                  }}
                  disabled={buyers === null}
                  className="adm-input font-normal"
                >
                  <option value="">{tp.noBuyer}</option>
                  {keptBuyer && (
                    <option value={keptBuyer.id}>
                      {/* Not in a list that loaded: the person has left. A list that failed says nothing about them. */}
                      {buyers === null ? keptBuyer.name || "—" : tp.buyerLeft(keptBuyer.name || "—")}
                    </option>
                  )}
                  {buyerOptions.map((buyer) => (
                    <option key={buyer.id} value={buyer.id}>
                      {buyer.name}
                    </option>
                  ))}
                </select>
                {buyers === null && <span className="adm-caption font-normal">{tp.errors.buyersFailed}</span>}
              </label>

              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-semibold text-adm-text">{tp.method}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map((option) => (
                    <label
                      key={option}
                      className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-adm-btn border border-adm-border px-2 py-2 text-sm text-adm-text has-checked:border-adm-accent has-checked:bg-adm-accent-tint has-disabled:cursor-default"
                    >
                      <input
                        type="radio"
                        name={`${baseId}-method`}
                        value={option}
                        checked={method === option}
                        onChange={() => {
                          setMethod(option);
                          touch();
                        }}
                        className="sr-only"
                      />
                      {t.finance.methods[option]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="adm-label sm:col-span-2 lg:col-span-3">
                <span>
                  {tp.note} <span className="font-normal text-adm-muted">({tp.optional})</span>
                </span>
                <textarea
                  rows={2}
                  maxLength={PURCHASE_LIMITS.noteMax}
                  placeholder={tp.notePlaceholder}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    touch();
                  }}
                  className="adm-input font-normal"
                />
              </label>
            </div>
          </Panel>
        </fieldset>

        <fieldset disabled={readOnly || pending} className="grid min-w-0 content-start gap-3">

          <Panel title={tp.linesTitle} flush>
            <ol>
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  position={index + 1}
                  ingredients={ingredients}
                  item={byId.get(line.ingredientId) ?? null}
                  problems={[...(check.errors.lines[index] ?? []), ...(errors.lines[index] ?? [])]}
                  idBase={`${baseId}-${line.key}`}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                  onAddNew={readOnly ? null : (typed) => setAdding({ lineKey: line.key, typed })}
                  quickAdd={
                    adding?.lineKey === line.key ? (
                      <QuickAdd
                        typed={adding.typed}
                        categories={categories}
                        locale={locale}
                        onCancel={() => setAdding(null)}
                        onAdded={(ingredient) => {
                          const category = categories.find((c) => c.id === ingredient.category_id)?.name ?? "—";
                          setIngredients((current) => [...current, formIngredient(ingredient, category, t, locale)]);
                          updateLine(line.key, { ingredientId: ingredient.id });
                          setAdding(null);
                        }}
                      />
                    ) : null
                  }
                  readOnly={readOnly}
                  t={t}
                  locale={locale}
                />
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-adm-border px-4 py-3 sm:px-5">
              {!readOnly && lines.length < PURCHASE_LIMITS.lines && (
                <button type="button" onClick={addLine} className="adm-btn adm-btn-outline adm-btn-sm">
                  <Plus aria-hidden="true" />
                  {tp.addLine}
                </button>
              )}
              <p className="ml-auto text-right" aria-live="polite">
                <span className="adm-caption mr-2">
                  {tp.total} · {tp.linesCount(check.payload.length)}
                </span>
                <span className="text-lg font-semibold tabular-nums text-adm-text">{sum(check.total)}</span>
              </p>
            </div>
          </Panel>
          {blocking && <p className="adm-caption">{blocking}</p>}
        </fieldset>

        {!readOnly && (
          <BeforeHydration>
            <div>{button}</div>
          </BeforeHydration>
        )}
      </form>
    </>
  );
}

function LineRow({
  line,
  position,
  ingredients,
  item,
  problems,
  idBase,
  onChange,
  onRemove,
  onAddNew,
  quickAdd,
  readOnly,
  t,
  locale,
}: {
  line: Line;
  position: number;
  ingredients: FormIngredient[];
  item: FormIngredient | null;
  problems: LineProblem[];
  idBase: string;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
  onAddNew: ((typed: string) => void) | null;
  quickAdd: React.ReactNode;
  readOnly: boolean;
  t: AdminDictionary;
  locale: Locale;
}) {
  const tp = t.purchases;
  const snapshot = line.snapshot && line.snapshot.ingredientId === line.ingredientId ? line.snapshot : null;
  const unit = snapshot?.unit ?? item?.unit ?? null;
  const unitLabel = unit ? t.ingredients.units[unit] : "";
  const usual = snapshot ? snapshot.usualPrice : (item?.usualPrice ?? null);
  const milli = parseQuantity(line.quantity);
  const amount = parseAmount(line.amount);
  const cost = milli !== null && amount !== null ? unitCost(amount, milli) : null;
  const diff = priceDiff(cost, usual);
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const perUnit = (value: number) => (unitLabel ? t.ingredients.priceText(sum(value), unitLabel) : sum(value));

  // Shown for a field that has something typed in it (an empty one only keeps Save disabled).
  const show = (problem: LineProblem) =>
    problems.includes(problem) &&
    (problem === "ingredient" ? Boolean(line.quantity.trim() || line.amount.trim()) : problem === "quantity" ? line.quantity.trim() !== "" : line.amount.trim() !== "");
  const errorId = `${idBase}-error`;
  const message = (["ingredient", "quantity", "amount"] as const).filter(show).map((p) => tp.lineErrors[p]);

  const tone =
    diff === null ? "text-adm-muted" : diff.pct > 0 ? "text-adm-caution" : diff.pct < 0 ? "text-adm-positive" : "text-adm-muted";

  return (
    <li className="adm-row grid gap-2 px-4 py-3 sm:px-5" aria-label={tp.lineLabel(position)}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_auto] sm:items-start">
        <IngredientPicker
          ingredients={ingredients}
          value={line.ingredientId}
          onChange={(id) => onChange({ ingredientId: id })}
          onAddNew={onAddNew}
          label={`${tp.ingredient}, ${tp.lineLabel(position)}`}
          placeholder={tp.pickIngredient}
          noMatches={tp.noMatches}
          addLabel={tp.addToCatalog}
          archivedLabel={tp.archivedOption}
          invalid={show("ingredient")}
          describedBy={message.length ? errorId : undefined}
          disabled={readOnly}
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <label className="relative block">
            <span className="sr-only">
              {tp.quantity}, {tp.lineLabel(position)}
            </span>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder={tp.quantity}
              maxLength={12}
              value={line.quantity}
              onChange={(event) => onChange({ quantity: event.target.value })}
              aria-invalid={show("quantity") || undefined}
              aria-describedby={message.length ? errorId : undefined}
              className={`adm-input w-full tabular-nums ${unitLabel ? "pr-12" : ""}`}
            />
            {unitLabel && (
              <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-adm-muted">
                {unitLabel}
              </span>
            )}
          </label>
          <label className="block">
            <span className="sr-only">
              {tp.amount}, {tp.lineLabel(position)}
            </span>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder={tp.amount}
              maxLength={16}
              value={line.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
              aria-invalid={show("amount") || undefined}
              aria-describedby={message.length ? errorId : undefined}
              className="adm-input w-full tabular-nums"
            />
          </label>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={tp.removeLine(position)}
            title={tp.removeLine(position)}
            className="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm adm-btn-icon justify-self-end"
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="adm-caption flex flex-wrap gap-x-2 tabular-nums" aria-live="polite">
        {cost !== null && (
          <span className="font-medium text-adm-text">
            {tp.unitCost}: {perUnit(cost)}
          </span>
        )}
        {cost !== null && milli !== null && unitLabel && (
          <span>({formatQuantity(milli, locale)} {unitLabel})</span>
        )}
        {item && (usual !== null ? <span>{tp.usual(perUnit(usual))}</span> : <span>{tp.noUsual}</span>)}
        {diff !== null && (
          <span className={`font-medium ${tone}`}>
            {diff.pct > 0 ? tp.above(diff.pct) : diff.pct < 0 ? tp.below(-diff.pct) : tp.same}
          </span>
        )}
      </p>
      {message.length > 0 && (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-adm-negative">
          {message.join(" ")}
        </p>
      )}
      {quickAdd}
    </li>
  );
}

/** "Not in the catalogue": a small form under the line that adds the ingredient and picks it. */
function QuickAdd({
  typed,
  categories,
  locale,
  onCancel,
  onAdded,
}: {
  typed: string;
  categories: { id: string; name: string }[];
  locale: Locale;
  onCancel: () => void;
  onAdded: (ingredient: Ingredient) => void;
}) {
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const ti = t.ingredients;
  const lang = t.common.fieldLang;
  const [nameRu, setNameRu] = useState(locale === "ru" ? typed : "");
  const [nameUz, setNameUz] = useState(locale === "ru" ? "" : typed);
  const [categoryId, setCategoryId] = useState("");
  const [unit, setUnit] = useState<IngredientUnit>("kg");
  const [price, setPrice] = useState("");
  const [fields, setFields] = useState<IngredientErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await quickAddIngredient({
        name_ru: nameRu,
        name_uz: nameUz,
        name_uzc: "",
        category_id: categoryId,
        unit,
        usual_price: price,
        pieces_per_unit: "",
      });
      if (result.ingredient) {
        onAdded(result.ingredient);
        return;
      }
      setFields(result.fields ?? {});
      setError(result.error ?? (result.fields && hasIngredientErrors(result.fields) ? ti.problems : null));
    });
  }

  const problem = (field: keyof IngredientErrors) => ingredientProblem(field, fields[field], t);

  if (categories.length === 0) {
    return <Notice tone="caution">{tp.errors.noCategories}</Notice>;
  }

  return (
    <div
      role="group"
      aria-label={tp.quickAddTitle}
      // Enter in these fields adds the ingredient; it must not send the receipt around them.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (!pending) submit();
        }
      }}
      className="grid gap-3 rounded-adm-control border border-adm-border bg-adm-surface-muted p-3"
    >
      <div>
        <p className="text-sm font-semibold text-adm-text">{tp.quickAddTitle}</p>
        <p className="adm-caption">{tp.quickAddLead}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="adm-label">
          {ti.name} ({lang.ru})
          <input value={nameRu} onChange={(e) => setNameRu(e.target.value)} maxLength={120} className="adm-input" aria-invalid={Boolean(fields.name_ru) || undefined} />
          {problem("name_ru") && <span role="alert" className="text-[13px] font-medium text-adm-negative">{problem("name_ru")}</span>}
        </label>
        <label className="adm-label">
          {ti.name} ({lang.uz})
          <input value={nameUz} onChange={(e) => setNameUz(e.target.value)} maxLength={120} className="adm-input" aria-invalid={Boolean(fields.name_uz) || undefined} />
          {problem("name_uz") && <span role="alert" className="text-[13px] font-medium text-adm-negative">{problem("name_uz")}</span>}
        </label>
        <label className="adm-label">
          {ti.category}
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="adm-input font-normal" aria-invalid={Boolean(fields.category) || undefined}>
            <option value="" disabled>
              {ti.chooseCategory}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {problem("category") && <span role="alert" className="text-[13px] font-medium text-adm-negative">{problem("category")}</span>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="adm-label">
            {ti.unit}
            <select value={unit} onChange={(e) => setUnit(e.target.value as IngredientUnit)} className="adm-input font-normal">
              {INGREDIENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {ti.units[u]}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-label">
            <span className="truncate">{ti.columns.price}</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              maxLength={20}
              placeholder={tp.optional}
              className="adm-input font-normal tabular-nums"
              aria-invalid={Boolean(fields.usual_price) || undefined}
            />
          </label>
        </div>
      </div>
      {problem("usual_price") && <p role="alert" className="text-[13px] font-medium text-adm-negative">{problem("usual_price")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-outline adm-btn-sm">
          {pending ? tp.quickAdding : tp.quickAdd}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="adm-btn adm-btn-ghost adm-btn-sm">
          {t.common.cancel}
        </button>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-adm-negative">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
