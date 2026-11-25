"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { saveCategory } from "@/lib/admin/ingredient-actions";
import type { IngredientCategory } from "@/lib/admin/ingredients";
import { localized } from "@/lib/data/localized";
import { Panel } from "../../kit/Panel";
import { CyrillicField } from "../CyrillicField";

export type CategoryRow = IngredientCategory & { used: number };

/**
 * The owner's category list under the catalogue: each category with how many ingredients in use it holds, a rename
 * form that opens in place, and a form for a new one. Categories are never deleted (ingredients point at them).
 */
export function CategoriesPanel({ categories, locale }: { categories: CategoryRow[]; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const tc = t.ingredients.categories;
  const [adding, setAdding] = useState(false);

  return (
    <Panel
      flush
      title={tc.title}
      description={tc.lead}
      actions={
        !adding && (
          <button type="button" onClick={() => setAdding(true)} className="adm-btn adm-btn-outline adm-btn-sm">
            <Plus aria-hidden="true" />
            {tc.add}
          </button>
        )
      }
    >
      {adding && (
        <div className="adm-row px-4 py-3 sm:px-5">
          <CategoryForm category={null} locale={locale} onDone={() => setAdding(false)} />
        </div>
      )}
      <ul>
        {categories.map((category) => (
          <CategoryItem key={category.id} category={category} locale={locale} />
        ))}
      </ul>
    </Panel>
  );
}

function CategoryItem({ category, locale }: { category: CategoryRow; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const tc = t.ingredients.categories;
  const [editing, setEditing] = useState(false);
  const name = localized(category, "name", locale);

  return (
    <li className="adm-row px-4 py-3 sm:px-5">
      {editing ? (
        <CategoryForm category={category} locale={locale} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-adm-text">{name}</p>
            <p className="adm-caption">{tc.used(category.used)}</p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={tc.editAria(name)}
            className="adm-btn adm-btn-ghost adm-btn-sm"
          >
            <Pencil aria-hidden="true" />
            <span className="max-sm:sr-only">{tc.edit}</span>
          </button>
        </div>
      )}
    </li>
  );
}

function CategoryForm({
  category,
  locale,
  onDone,
}: {
  category: IngredientCategory | null;
  locale: Locale;
  onDone: () => void;
}) {
  const t = getAdminDictionary(locale);
  const tc = t.ingredients.categories;
  const lang = t.common.fieldLang;
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const result = await saveCategory(prev, form);
    if (result.ok) onDone();
    return result;
  }, {});

  return (
    <form action={action} className="grid gap-3">
      {category && <input type="hidden" name="id" value={category.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="adm-label">
          {tc.name} ({lang.ru})
          <input name="name_ru" required maxLength={60} defaultValue={category?.name_ru} className="adm-input" />
        </label>
        <label className="adm-label">
          {tc.name} ({lang.uz})
          <input name="name_uz" required maxLength={60} defaultValue={category?.name_uz} className="adm-input" />
        </label>
        <CyrillicField
          name="name_uzc"
          latinName="name_uz"
          label={`${tc.name} (${lang.uzc})`}
          defaultValue={category?.name_uzc ?? ""}
          t={t.cyrillic}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-outline adm-btn-sm">
          {pending ? t.common.saving : t.common.save}
        </button>
        <button type="button" onClick={onDone} disabled={pending} className="adm-btn adm-btn-ghost adm-btn-sm">
          {t.common.cancel}
        </button>
        {state.error && (
          <p role="alert" className="text-[13px] font-medium text-adm-negative">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
