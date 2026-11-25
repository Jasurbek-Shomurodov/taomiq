"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import type { FormState } from "@/lib/admin/actions";
import { saveIngredient, setIngredientArchived, type IngredientFormState } from "@/lib/admin/ingredient-actions";
import {
  INGREDIENT_LIMITS,
  INGREDIENT_UNITS,
  checkIngredient,
  hasIngredientErrors,
  type Ingredient,
  type IngredientErrors,
  type IngredientField,
  type IngredientInput,
} from "@/lib/admin/ingredients";
import { localized } from "@/lib/data/localized";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";
import { CyrillicField } from "../CyrillicField";

const FORM_ID = "ingredient-form";

/** The message for a field's problem, in the reader's language. */
export function ingredientProblem(
  field: IngredientField,
  problem: IngredientErrors[IngredientField],
  t: AdminDictionary,
): string | null {
  const e = t.ingredients.fieldErrors;
  switch (problem) {
    case undefined:
      return null;
    case "duplicate":
      return e.duplicate;
    case "too_long":
      return e.tooLong(INGREDIENT_LIMITS.nameMax);
    case "required":
      return field === "category" ? e.category : field === "unit" ? e.unit : e.required;
    case "invalid":
      return field === "usual_price" ? e.price : field === "pieces_per_unit" ? e.pieces : e.required;
  }
}

function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error: string | null; children: ReactNode }) {
  return (
    <label className="adm-label">
      {label}
      {children}
      {hint && <span className="adm-caption font-normal">{hint}</span>}
      {error && (
        <span role="alert" className="text-[13px] font-medium text-adm-negative">
          {error}
        </span>
      )}
    </label>
  );
}

function initialInput(ingredient: Ingredient | null, defaultCategory: string): IngredientInput {
  return {
    name_ru: ingredient?.name_ru ?? "",
    name_uz: ingredient?.name_uz ?? "",
    name_uzc: ingredient?.name_uzc ?? "",
    category_id: ingredient?.category_id ?? defaultCategory,
    unit: ingredient?.unit ?? "kg",
    usual_price: ingredient?.usual_price === null || ingredient?.usual_price === undefined ? "" : String(ingredient.usual_price),
    pieces_per_unit:
      ingredient?.pieces_per_unit === null || ingredient?.pieces_per_unit === undefined ? "" : String(ingredient.pieces_per_unit),
  };
}

function readForm(form: HTMLFormElement): IngredientInput {
  const data = new FormData(form);
  const get = (key: string) => String(data.get(key) ?? "");
  return {
    name_ru: get("name_ru"),
    name_uz: get("name_uz"),
    name_uzc: get("name_uzc"),
    category_id: get("category_id"),
    unit: get("unit"),
    usual_price: get("usual_price"),
    pieces_per_unit: get("pieces_per_unit"),
  };
}

const same = (a: IngredientInput, b: IngredientInput) =>
  (Object.keys(a) as (keyof IngredientInput)[]).every((key) => a[key].trim() === b[key].trim());

/**
 * The ingredient editor: names (with "fill Cyrillic from Latin"), category, unit, usual price, pieces per unit. Save in
 * the top bar, disabled until something changed. A new ingredient goes back to the list when saved.
 */
export function IngredientForm({
  ingredient,
  categories,
  locale,
}: {
  ingredient: Ingredient | null;
  categories: { id: string; name: string }[];
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<IngredientFormState, FormData>(saveIngredient, {});
  const t = getAdminDictionary(locale);
  const ti = t.ingredients;
  const lang = t.common.fieldLang;
  const formRef = useRef<HTMLFormElement>(null);
  const [initial] = useState(() => initialInput(ingredient, ""));
  const [dirty, setDirty] = useState(ingredient === null);
  const [local, setLocal] = useState<IngredientErrors>({});
  const [server, setServer] = useState<IngredientErrors>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setServer(state.fields ?? {});
  }
  const errors: IngredientErrors = { ...local, ...server };

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.fields) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  function onChange() {
    const form = formRef.current;
    if (!form) return;
    setDirty(ingredient === null || !same(readForm(form), initial));
    if (Object.keys(server).length) setServer({});
  }

  const button = (
    <button
      type="submit"
      form={FORM_ID}
      disabled={pending || !dirty}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? t.common.saving : t.common.save}
    </button>
  );
  const problem = (field: IngredientField) => ingredientProblem(field, errors[field], t);
  const anyProblem = hasIngredientErrors(errors);

  return (
    <>
      <TopBarActions>{button}</TopBarActions>
      <form
        id={FORM_ID}
        ref={formRef}
        action={action}
        noValidate
        onInput={onChange}
        onChange={onChange}
        onSubmit={(event) => {
          const checked = checkIngredient(readForm(event.currentTarget), categories.map((c) => c.id));
          setLocal(checked);
          if (hasIngredientErrors(checked)) event.preventDefault();
        }}
        className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start"
      >
        {ingredient && <input type="hidden" name="id" value={ingredient.id} />}
        <div ref={noticeRef} className="empty:hidden xl:col-span-2">
          {(state.error || anyProblem) && <Notice tone="negative">{state.error ?? ti.problems}</Notice>}
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Panel title={ti.namesTitle}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`${ti.name} (${lang.ru})`} error={problem("name_ru")}>
                <input
                  name="name_ru"
                  required
                  maxLength={INGREDIENT_LIMITS.nameMax}
                  defaultValue={initial.name_ru}
                  aria-invalid={Boolean(errors.name_ru) || undefined}
                  className="adm-input"
                />
              </Field>
              <Field label={`${ti.name} (${lang.uz})`} error={problem("name_uz")}>
                <input
                  name="name_uz"
                  required
                  maxLength={INGREDIENT_LIMITS.nameMax}
                  defaultValue={initial.name_uz}
                  aria-invalid={Boolean(errors.name_uz) || undefined}
                  className="adm-input"
                />
              </Field>
              <CyrillicField
                name="name_uzc"
                latinName="name_uz"
                label={`${ti.name} (${lang.uzc})`}
                defaultValue={initial.name_uzc}
                t={t.cyrillic}
                onFill={() => setDirty(true)}
              />
            </div>
          </Panel>

          <Panel title={ti.detailsTitle}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={ti.category} error={problem("category")}>
                <select
                  name="category_id"
                  required
                  defaultValue={initial.category_id}
                  aria-invalid={Boolean(errors.category) || undefined}
                  className="adm-input font-normal"
                >
                  <option value="" disabled>
                    {ti.chooseCategory}
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ti.unit} hint={ti.unitHint} error={problem("unit")}>
                <select name="unit" required defaultValue={initial.unit} className="adm-input font-normal">
                  {INGREDIENT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {ti.unitNames[unit]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ti.usualPrice} hint={ti.usualPriceHint} error={problem("usual_price")}>
                <input
                  name="usual_price"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={20}
                  defaultValue={initial.usual_price}
                  aria-invalid={Boolean(errors.usual_price) || undefined}
                  className="adm-input font-normal tabular-nums"
                />
              </Field>
              <Field label={ti.pieces} hint={ti.piecesHint} error={problem("pieces_per_unit")}>
                <input
                  name="pieces_per_unit"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={7}
                  defaultValue={initial.pieces_per_unit}
                  aria-invalid={Boolean(errors.pieces_per_unit) || undefined}
                  className="adm-input font-normal tabular-nums"
                />
              </Field>
            </div>
          </Panel>
        </div>

        <BeforeHydration>
          <div className="xl:col-span-2">{button}</div>
        </BeforeHydration>
      </form>
    </>
  );
}

/** Archive (asked first, naming the ingredient) or restore, under the editor. */
export function IngredientArchive({ ingredient, locale }: { ingredient: Ingredient; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setIngredientArchived, {});
  const t = getAdminDictionary(locale);
  const ti = t.ingredients;
  const id = useId();
  const archived = ingredient.archived_at !== null;
  const name = localized(ingredient, "name", locale);

  return (
    <Panel title={ti.archiveTitle} description={ti.archiveLead}>
      <form action={action} className="grid justify-items-start gap-2">
        <input type="hidden" name="id" value={ingredient.id} />
        <input type="hidden" name="archive" value={archived ? "0" : "1"} />
        {archived ? (
          <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-outline">
            {pending ? ti.restoring : ti.restore}
          </button>
        ) : (
          <ConfirmDialog
            trigger={ti.archive}
            triggerClassName="adm-btn adm-btn-outline"
            disabled={pending}
            title={ti.archiveConfirmTitle(name)}
            description={ti.archiveConfirmText}
            confirmLabel={ti.archive}
            pendingLabel={ti.archiving}
            cancelLabel={t.common.cancel}
            pending={pending}
          />
        )}
        <p id={id} aria-live="polite" className="empty:hidden">
          {state.error ? (
            <span role="alert" className="text-sm font-medium text-adm-negative">
              {state.error}
            </span>
          ) : state.ok ? (
            <span className="text-sm text-adm-positive">{state.ok}</span>
          ) : null}
        </p>
      </form>
    </Panel>
  );
}
