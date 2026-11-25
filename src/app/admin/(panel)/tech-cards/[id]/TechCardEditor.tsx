"use client";

import { Copy, Plus, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { formatQuantity } from "@/lib/admin/purchases";
import {
  loadRecipeForCopy,
  previewTechCardCost,
  saveTechCard,
  type TechCardFormState,
} from "@/lib/admin/tech-card-actions";
import {
  TECH_CARD_LIMITS,
  TECH_UNIT_FOR,
  checkTechCard,
  draftFromLine,
  hasTechCardErrors,
  parseBatch,
  previewKey,
  previewPayload,
  type CostPreview,
  type Recipe,
  type TechCardErrors,
  type TechLineProblem,
  type TechUnit,
} from "@/lib/admin/tech-cards";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarActions } from "../../../shell/TopBarSlot";
import type { FormIngredient } from "../../purchases/form-ingredient";
import { IngredientPicker } from "../../purchases/IngredientPicker";

/*
 * The tech card editor (owners and managers; docs/plans/zarkebab-feature-port.md, slice 7): ingredient lines from the
 * catalogue with a quantity for one batch (the unit follows the ingredient: grams, millilitres or pieces), the batch's
 * cooked weight, method and notes. The cost of each line, of the batch, per 100 g and per typical portion is worked
 * out by the database (public.tech_card_cost_preview) a moment after typing stops, never in the browser. Save sits in
 * the top bar and stays disabled until the card is valid and changed. The rules are lib/admin/tech-cards.ts; the
 * action and public.tech_card_save check them again.
 */

const FORM_ID = "tech-card-form";
const PREVIEW_DELAY = 450;

type Line = {
  key: number;
  ingredientId: string;
  quantity: string;
  /** A saved line whose unit no longer fits its ingredient: what it said, until a new quantity is typed. */
  was: { milli: number; unit: TechUnit } | null;
};

function serialize(state: { batch: string; method: string; notes: string; lines: Line[] }): string {
  return JSON.stringify([
    parseBatch(state.batch) ?? state.batch.trim(),
    state.method.trim(),
    state.notes.trim(),
    state.lines.filter((l) => l.ingredientId || l.quantity.trim()).map((l) => [l.ingredientId, l.quantity.trim()]),
  ]);
}

export function TechCardEditor({
  dish,
  recipe,
  ingredients,
  initialPreview,
  copySources,
  locale,
}: {
  dish: { id: string; name: string; portionG: number };
  recipe: Recipe | null;
  ingredients: FormIngredient[];
  /** The cost of the saved lines, read with the page; null when that read failed (the editor asks again). */
  initialPreview: CostPreview | null;
  /** Dishes with a recipe to copy from; null when the list could not be read. */
  copySources: { id: string; name: string }[] | null;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<TechCardFormState, FormData>(saveTechCard, {});
  const t = getAdminDictionary(locale);
  const tc = t.techCards;
  const baseId = useId();
  const byId = new Map(ingredients.map((item) => [item.id, item]));
  const unitOf = (id: string) => byId.get(id)?.unit ?? null;

  const [initial] = useState(() => {
    const lines: Line[] = (recipe?.lines ?? []).map((line, index) => ({ key: index, ...draftFromLine(line, unitOf) }));
    if (lines.length === 0) lines.push({ key: 0, ingredientId: "", quantity: "", was: null });
    return {
      batch: recipe ? String(recipe.batchOutputG) : "",
      method: recipe?.method ?? "",
      notes: recipe?.notes ?? "",
      lines,
    };
  });
  // The card's version as this editor loaded it, for the stale-write guard: never a newer one from a later server
  // render while the typed edits stay, which would let this save overwrite a colleague's change unseen. (The page
  // also keys the editor by updatedAt, so a saved card remounts it; the guard does not depend on that.)
  const [loadedAt] = useState(recipe?.updatedAt ?? "");
  const [batch, setBatch] = useState(initial.batch);
  const [method, setMethod] = useState(initial.method);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [nextKey, setNextKey] = useState(initial.lines.length);
  const [initialKey] = useState(() => serialize(initial));

  // Server-named problems are kept until the person edits again.
  const [server, setServer] = useState<TechCardErrors | null>(null);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setServer(state.errors ?? null);
  }
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.errors) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  const check = checkTechCard({ batch, method, notes, lines }, unitOf);
  const changed = serialize({ batch, method, notes, lines }) !== initialKey;
  const canSave = changed && !hasTechCardErrors(check.errors) && !pending;

  // ---------- the live cost ----------
  const payload = previewPayload(lines, unitOf);
  const batchValue = parseBatch(batch);
  const wanted = previewKey(batchValue, payload);
  // The figures answer the request key they were asked with; while it is not the key of what is on screen (typing,
  // waiting for the answer) they are drawn muted. Line i of the answer is the i-th line of the payload.
  const [preview, setPreview] = useState<{ key: string; value: CostPreview | null }>(() => ({
    key: initialPreview ? previewKey(recipe?.batchOutputG ?? null, previewPayload(initial.lines, unitOf)) : "",
    value: initialPreview,
  }));
  useEffect(() => {
    if (wanted === preview.key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [batchOutputG, sent] = JSON.parse(wanted) as [number | null, [string, string, TechUnit][]];
      const value = await previewTechCardCost({
        batchOutputG,
        portionG: dish.portionG,
        lines: sent.map(([ingredient_id, quantity, unit]) => ({ ingredient_id, quantity, unit })),
      });
      if (!cancelled) setPreview({ key: wanted, value });
    }, PREVIEW_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wanted, preview.key, dish.portionG]);
  const fresh = preview.key === wanted;
  const lineCost = new Map(
    fresh ? payload.map((p, i) => [lines[p.index].key, preview.value?.lines[i] ?? null] as const) : [],
  );

  // ---------- lines ----------
  function touch() {
    if (server) setServer(null);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    touch();
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, ingredientId: "", quantity: "", was: null }]);
    setNextKey((n) => n + 1);
  }

  function removeLine(key: number) {
    setLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next.length ? next : [{ key: nextKey, ingredientId: "", quantity: "", was: null }];
    });
    setNextKey((n) => n + 1);
    touch();
  }

  // ---------- copy from another dish ----------
  const [copyFrom, setCopyFrom] = useState("");
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copying, startCopy] = useTransition();
  const hasLines = lines.some((line) => line.ingredientId || line.quantity.trim());

  function copy() {
    if (!copyFrom) return;
    setCopyError(null);
    startCopy(async () => {
      const source = await loadRecipeForCopy(copyFrom);
      if (!source) {
        setCopyError(tc.copyFailed);
        return;
      }
      // Built like the card's own lines: a unit that no longer fits its ingredient is cleared and flagged.
      const copied: Line[] = source.lines.map((line, index) => ({ key: nextKey + index, ...draftFromLine(line, unitOf) }));
      setLines(copied.length ? copied : [{ key: nextKey, ingredientId: "", quantity: "", was: null }]);
      setNextKey((n) => n + Math.max(1, copied.length));
      setBatch(String(source.batchOutputG));
      if (!method.trim()) setMethod(source.method);
      touch();
    });
  }

  // ---------- messages ----------
  const sum = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${formatSum(value)} ${t.common.currency}`;
  const errors: TechCardErrors = server ?? { form: [], lines: {} };
  const formError = (problem: TechCardErrors["form"][number]) => errors.form.includes(problem);

  const blocking = (() => {
    if (!changed) return null;
    const e = check.errors;
    if (e.form.includes("batch")) return tc.formErrors.batch;
    const first = Object.keys(e.lines).map(Number).sort((a, b) => a - b)[0];
    if (first !== undefined) return `${tc.lineLabel(first + 1)}: ${tc.lineErrors[e.lines[first][0]]}`;
    if (e.form.includes("lines")) return tc.formErrors.lines(TECH_CARD_LIMITS.lines);
    if (e.form.includes("method")) return tc.formErrors.method(TECH_CARD_LIMITS.methodMax);
    if (e.form.includes("notes")) return tc.formErrors.notes(TECH_CARD_LIMITS.notesMax);
    return null;
  })();

  const button = (
    <button type="submit" form={FORM_ID} disabled={!canSave} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
      {pending ? t.common.saving : t.common.save}
    </button>
  );

  return (
    <>
      <TopBarActions>
        {recipe && (
          <Link href={`/tech-cards/print?id=${dish.id}`} className="adm-btn adm-btn-outline" title={tc.print}>
            <Printer aria-hidden="true" />
            <span className="max-sm:sr-only">{tc.print}</span>
          </Link>
        )}
        {button}
      </TopBarActions>

      <form
        id={FORM_ID}
        action={action}
        noValidate
        onSubmit={(event) => {
          if (!canSave) event.preventDefault();
        }}
        className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start"
      >
        <input type="hidden" name="dish_id" value={dish.id} />
        <input type="hidden" name="loaded_at" value={loadedAt} />
        <input type="hidden" name="batch_output_g" value={batch} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="notes" value={notes} />
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(lines.map((line) => ({ ingredient_id: line.ingredientId, quantity: line.quantity })))}
        />

        <div ref={noticeRef} className="empty:hidden xl:col-span-2">
          {(state.error || (server && hasTechCardErrors(server))) && (
            <Notice tone="negative">{state.error ?? tc.problems}</Notice>
          )}
          {!recipe && <p className="adm-muted">{tc.newLead}</p>}
        </div>

        <fieldset disabled={pending} className="grid min-w-0 content-start gap-5">
          <Panel title={tc.ingredientsTitle} description={tc.ingredientsLead} flush>
            <ol>
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  position={index + 1}
                  ingredients={ingredients}
                  item={byId.get(line.ingredientId) ?? null}
                  problems={[...(check.errors.lines[index] ?? []), ...(errors.lines[index] ?? [])]}
                  cost={fresh ? (lineCost.get(line.key) ?? null) : null}
                  costPending={!fresh}
                  idBase={`${baseId}-${line.key}`}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => removeLine(line.key)}
                  t={t}
                  locale={locale}
                />
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-adm-border px-4 py-3 sm:px-5">
              {lines.length < TECH_CARD_LIMITS.lines && (
                <button type="button" onClick={addLine} className="adm-btn adm-btn-outline adm-btn-sm">
                  <Plus aria-hidden="true" />
                  {tc.addLine}
                </button>
              )}
              <p className="adm-caption ml-auto">{tc.linesCount(check.payload.length)}</p>
            </div>
          </Panel>
          {blocking && <p className="adm-caption">{blocking}</p>}

          <Panel title={tc.methodTitle}>
            <label className="adm-label">
              <span className="sr-only">{tc.methodTitle}</span>
              <textarea
                rows={8}
                maxLength={TECH_CARD_LIMITS.methodMax}
                placeholder={tc.methodPlaceholder}
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value);
                  touch();
                }}
                aria-invalid={formError("method") || undefined}
                className="adm-input font-normal"
              />
            </label>
          </Panel>
          <Panel title={tc.notesTitle}>
            <label className="adm-label">
              <span className="sr-only">{tc.notesTitle}</span>
              <textarea
                rows={3}
                maxLength={TECH_CARD_LIMITS.notesMax}
                placeholder={tc.notesPlaceholder}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  touch();
                }}
                aria-invalid={formError("notes") || undefined}
                className="adm-input font-normal"
              />
            </label>
          </Panel>
        </fieldset>

        <div className="grid min-w-0 content-start gap-5">
          <Panel title={tc.batchTitle}>
            <label className="adm-label">
              {tc.batchOutput}
              <span className="relative block">
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={9}
                  value={batch}
                  disabled={pending}
                  onChange={(event) => {
                    setBatch(event.target.value);
                    touch();
                  }}
                  aria-invalid={(batch.trim() !== "" && batchValue === null) || formError("batch") || undefined}
                  className="adm-input w-full pr-10 font-normal tabular-nums"
                />
                <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-adm-muted">
                  {t.common.g}
                </span>
              </span>
              <span className="adm-caption font-normal">{tc.batchHint}</span>
            </label>
          </Panel>

          <Panel title={tc.costTitle} description={fresh ? tc.costLead : tc.costUpdating}>
            <dl className="grid gap-3 text-sm" aria-live="polite" aria-busy={!fresh || undefined}>
              <CostRow label={tc.batchCost} value={sum(preview.value?.batchCost)} dim={!fresh} />
              <CostRow label={tc.cost100} value={sum(preview.value?.cost100)} dim={!fresh} strong />
              <CostRow label={tc.costPortion(formatSum(dish.portionG))} value={sum(preview.value?.costPortion)} dim={!fresh} />
            </dl>
            {fresh && preview.value === null && preview.key !== "" && (
              <p role="alert" className="mt-3 text-[13px] font-medium text-adm-negative">{tc.costFailed}</p>
            )}
            {fresh && preview.value && !preview.value.complete && (
              <p className="adm-caption mt-3">{batchValue === null ? tc.costNeedsBatch : tc.costIncomplete}</p>
            )}
          </Panel>

          <Panel title={tc.copyTitle} description={tc.copyLead}>
            {copySources === null ? (
              <p className="adm-caption">{tc.copySourcesFailed}</p>
            ) : copySources.length === 0 ? (
              <p className="adm-caption">{tc.copyNone}</p>
            ) : (
              <div className="grid gap-2">
                <label className="adm-label">
                  <span className="sr-only">{tc.copyFrom}</span>
                  <select
                    value={copyFrom}
                    disabled={pending || copying}
                    onChange={(event) => setCopyFrom(event.target.value)}
                    className="adm-input font-normal"
                  >
                    <option value="">{tc.copyFrom}</option>
                    {copySources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ConfirmDialog
                  trigger={
                    <>
                      <Copy aria-hidden="true" />
                      {copying ? tc.copying : tc.copy}
                    </>
                  }
                  triggerClassName="adm-btn adm-btn-outline adm-btn-sm w-fit"
                  disabled={!copyFrom || pending || copying}
                  title={tc.copyConfirmTitle}
                  description={tc.copyConfirmText}
                  confirmLabel={tc.copy}
                  cancelLabel={t.common.cancel}
                  shouldAsk={() => hasLines}
                  onConfirm={copy}
                />
                {copyError && <p role="alert" className="text-[13px] font-medium text-adm-negative">{copyError}</p>}
              </div>
            )}
          </Panel>
        </div>

        <BeforeHydration>
          <div className="xl:col-span-2">{button}</div>
        </BeforeHydration>
      </form>
    </>
  );
}

function CostRow({ label, value, dim, strong = false }: { label: string; value: string; dim: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-adm-muted">{label}</dt>
      <dd
        className={`whitespace-nowrap tabular-nums ${strong ? "text-lg font-semibold" : "font-medium"} ${
          dim ? "text-adm-muted" : "text-adm-text"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function LineRow({
  line,
  position,
  ingredients,
  item,
  problems,
  cost,
  costPending,
  idBase,
  onChange,
  onRemove,
  t,
  locale,
}: {
  line: Line;
  position: number;
  ingredients: FormIngredient[];
  item: FormIngredient | null;
  problems: TechLineProblem[];
  cost: CostPreview["lines"][number] | null;
  costPending: boolean;
  idBase: string;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
  t: AdminDictionary;
  locale: Locale;
}) {
  const tc = t.techCards;
  const unit = item ? TECH_UNIT_FOR[item.unit] : null;
  const unitLabel = unit ? tc.units[unit] : "";
  const show = (problem: TechLineProblem) =>
    problems.includes(problem) &&
    (problem === "quantity" ? line.quantity.trim() !== "" : problem === "ingredient" ? line.quantity.trim() !== "" : true);
  const errorId = `${idBase}-error`;
  const message = (["ingredient", "duplicate", "quantity"] as const).filter(show).map((p) => tc.lineErrors[p]);
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;

  return (
    <li className="adm-row grid gap-2 px-4 py-3 sm:px-5" aria-label={tc.lineLabel(position)}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto] sm:items-start">
        <IngredientPicker
          ingredients={ingredients}
          value={line.ingredientId}
          onChange={(id) => onChange({ ingredientId: id })}
          onAddNew={null}
          label={`${tc.columns.ingredient}, ${tc.lineLabel(position)}`}
          placeholder={tc.pickIngredient}
          noMatches={tc.noMatches}
          addLabel={(typed) => typed}
          archivedLabel={t.purchases.archivedOption}
          invalid={show("ingredient") || show("duplicate")}
          describedBy={message.length ? errorId : undefined}
          disabled={false}
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <label className="relative block">
            <span className="sr-only">
              {tc.columns.quantity}, {tc.lineLabel(position)}
            </span>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder={tc.columns.quantity}
              maxLength={12}
              value={line.quantity}
              onChange={(event) => onChange({ quantity: event.target.value, was: null })}
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
          <p className="flex min-h-10 items-center justify-end text-right text-sm tabular-nums" aria-live="polite">
            <span className="sr-only">{tc.lineCost}: </span>
            {cost?.cost !== null && cost?.cost !== undefined ? (
              <span className={costPending ? "text-adm-muted" : "font-medium text-adm-text"}>{sum(cost.cost)}</span>
            ) : (
              <span className="text-adm-muted">—</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={tc.removeLine(position)}
          title={tc.removeLine(position)}
          className="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm adm-btn-icon justify-self-end"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      {line.was && (
        <p className="text-[13px] font-medium text-adm-caution">
          {tc.unitChanged(`${formatQuantity(line.was.milli, locale)} ${tc.units[line.was.unit]}`, unitLabel || "—")}
        </p>
      )}
      {!costPending && cost?.problem === "price" && <p className="adm-caption">{tc.costProblems.price}</p>}
      {!costPending && cost?.problem === "unit" && <p className="adm-caption text-adm-caution">{tc.costProblems.unit}</p>}
      {message.length > 0 && (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-adm-negative">
          {message.join(" ")}
        </p>
      )}
    </li>
  );
}
