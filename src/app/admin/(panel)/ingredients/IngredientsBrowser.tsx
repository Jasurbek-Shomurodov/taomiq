"use client";

import { Archive, Carrot, Filter, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { foldSearchText } from "@/lib/admin/dish-status";
import { INGREDIENT_STATUSES, type IngredientStatus } from "@/lib/admin/ingredients";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { SearchInput } from "../../kit/SearchField";

/** One ingredient as the list needs it; the server page builds these. */
export type IngredientListItem = {
  id: string;
  /** The name in the panel's language. */
  title: string;
  /** The Latin name for a Russian panel, the Russian one otherwise. */
  subtitle: string;
  /** The names in all three languages, folded (foldSearchText). */
  search: string;
  categoryId: string;
  category: string;
  /** The unit's short label ("кг"). */
  unit: string;
  /** "5 000 сум / кг", or null without a usual price. */
  price: string | null;
  pieces: number | null;
  archived: boolean;
};

type Filters = { q: string; category: string; status: IngredientStatus };

/** Puts the filters in the address (history.replaceState: no server round trip), so a reload shows the same list. */
function writeAddress({ q, category, status }: Filters) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
  set("q", q);
  set("category", category);
  set("status", status === "active" ? "" : status);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The catalogue: search over the names in any language, a category filter and In use / Archive, then a table (a
 * stacked list on a phone). Filtered here; the whole catalogue comes from the server.
 */
export function IngredientsBrowser({
  items,
  categories,
  initial,
  locale,
}: {
  items: IngredientListItem[];
  categories: { id: string; name: string }[];
  initial: Filters;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const ti = t.ingredients;
  const [query, setQuery] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [status, setStatus] = useState<IngredientStatus>(initial.status);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: Partial<Filters>, debounce = false) {
    const filters = { q: query.trim(), category, status, ...next };
    if (next.q !== undefined) filters.q = next.q.trim();
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => writeAddress(filters), 250);
    else writeAddress(filters);
  }

  const words = foldSearchText(query).split(" ").filter(Boolean);
  const ofStatus = items.filter((item) => item.archived === (status === "archived"));
  const shown = ofStatus.filter(
    (item) => (!category || item.categoryId === category) && words.every((word) => item.search.includes(word)),
  );
  const filtering = category !== "" || words.length > 0;
  const counts = {
    active: items.filter((item) => !item.archived).length,
    archived: items.filter((item) => item.archived).length,
  };

  function clear() {
    setQuery("");
    setCategory("");
    update({ q: "", category: "" });
  }

  return (
    <>
      <Panel as="div" className="flex flex-wrap items-center gap-3">
        <SearchInput
          label={ti.searchLabel}
          placeholder={ti.searchPlaceholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            update({ q: event.target.value }, true);
          }}
          maxLength={80}
          enterKeyHint="search"
          className="w-full sm:w-auto sm:min-w-56 sm:flex-1"
        />
        <label className="flex min-w-0 items-center gap-2 max-sm:flex-1">
          <span className="sr-only">{ti.categoryLabel}</span>
          <Filter aria-hidden="true" className="size-4 shrink-0 text-adm-muted" />
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              update({ category: event.target.value });
            }}
            className="adm-input w-full sm:w-auto"
          >
            <option value="">{ti.allCategories}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={ti.statusAria} className="adm-segmented">
          {INGREDIENT_STATUSES.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              onClick={() => {
                setStatus(key);
                update({ status: key });
              }}
            >
              {key === "archived" && <Archive aria-hidden="true" className="size-4" />}
              {ti.statuses[key]}
              <span className="adm-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </Panel>

      {ofStatus.length > 0 && (
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="adm-caption tabular-nums" aria-live="polite">
            {filtering ? ti.countOf(shown.length, ofStatus.length) : ti.count(ofStatus.length)}
          </p>
          {filtering && shown.length > 0 && (
            <button type="button" onClick={clear} className="adm-btn adm-btn-ghost adm-btn-sm">
              <X aria-hidden="true" />
              {ti.clearFilters}
            </button>
          )}
        </div>
      )}

      {ofStatus.length === 0 ? (
        <Panel>
          {status === "archived" ? (
            <EmptyState icon={Archive}>{ti.emptyArchived}</EmptyState>
          ) : (
            <EmptyState
              icon={Carrot}
              action={
                <Link href="/ingredients/new" className="adm-btn adm-btn-primary">
                  <Plus aria-hidden="true" />
                  {ti.add}
                </Link>
              }
            >
              {ti.empty}
            </EmptyState>
          )}
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Filter}
            action={
              <button type="button" onClick={clear} className="adm-btn adm-btn-outline">
                {ti.clearFilters}
              </button>
            }
          >
            {ti.filteredEmpty}
          </EmptyState>
        </Panel>
      ) : (
        <Panel flush className="overflow-x-auto">
          <table className="w-full text-left text-sm sm:min-w-[40rem]">
            <thead className="adm-table-head max-sm:sr-only">
              <tr>
                <th className="px-4 py-2.5 font-medium">{ti.columns.name}</th>
                <th className="px-4 py-2.5 font-medium">{ti.columns.category}</th>
                <th className="px-4 py-2.5 font-medium">{ti.columns.unit}</th>
                <th className="px-4 py-2.5 text-right font-medium">{ti.columns.price}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className="adm-row max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:px-4 max-sm:py-3">
                  <td className="sm:px-4 sm:py-3">
                    <Link href={`/ingredients/${item.id}`} className="grid gap-0.5">
                      <span className="font-semibold text-adm-text">{item.title}</span>
                      <span className="text-[13px] text-adm-muted">{item.subtitle}</span>
                      {item.archived && (
                        <Badge tone="neutral" className="mt-1 w-fit">
                          {ti.archivedBadge}
                        </Badge>
                      )}
                    </Link>
                  </td>
                  <td className="text-adm-muted max-sm:order-3 max-sm:col-span-2 max-sm:text-[13px] sm:px-4 sm:py-3">
                    {item.category}
                  </td>
                  <td className="text-adm-muted max-sm:hidden sm:px-4 sm:py-3">
                    {item.unit}
                    {item.pieces !== null && (
                      <span className="block text-[13px]">{ti.piecesText(item.pieces, item.unit)}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums sm:px-4 sm:py-3">
                    {item.price ?? <span className="text-adm-muted">{ti.noPrice}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
