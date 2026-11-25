"use client";

import { ClipboardList, Filter, Printer, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { foldSearchText } from "@/lib/admin/dish-status";
import {
  TECH_CARD_FILTERS,
  isCardReady,
  isCostState,
  isRecipeState,
  isTechCardFilter,
  type CostState,
  type RecipeState,
  type TechCardFilter,
} from "@/lib/admin/tech-cards";
import { Badge, type Tone } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { SearchInput } from "../../kit/SearchField";

/** One dish as the list needs it; the server page builds these. Costs only for owners and managers. */
export type TechCardItem = {
  id: string;
  title: string;
  subtitle: string;
  /** The names in all three languages, folded (foldSearchText). */
  search: string;
  /** The cost state (owners and managers) or the recipe state (the kitchen). */
  state: CostState | RecipeState;
  recipeReady: boolean;
  lines: number;
  batchOutputG: number | null;
  weight: number;
  verified: boolean;
  cost100: number | null;
  costPortion: number | null;
};

const STATE_TONE: Record<CostState | RecipeState, Tone> = {
  none: "neutral",
  empty: "caution",
  unit: "negative",
  price: "caution",
  ok: "positive",
  ready: "positive",
};

function writeAddress({ q, status }: { q: string; status: TechCardFilter | null }) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  if (status) url.searchParams.set("status", status);
  else url.searchParams.delete("status");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The tech cards list: search over the names in any language, the All / Ready / Not complete filter (?q=, ?status=,
 * kept in the address as on the dishes list), and a table of dishes with their card state. Ticking dishes and pressing
 * Print opens the print view of those cards (a plain GET form, so it works before the scripts run too). Uses
 * useSearchParams: the page renders it inside <Suspense>.
 */
export function TechCardsBrowser({ items, stock, locale }: { items: TechCardItem[]; stock: boolean; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const tc = t.techCards;
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status") ?? "";
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState<TechCardFilter | null>(isTechCardFilter(statusParam) ? statusParam : null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const words = foldSearchText(query).split(" ").filter(Boolean);
  const shown = items.filter((item) => {
    const ready = isCardReady(item.state);
    if (status === "ready" && !ready) return false;
    if (status === "incomplete" && ready) return false;
    return words.every((word) => item.search.includes(word));
  });
  const shownIds = new Set(shown.map((item) => item.id));
  const filtering = status !== null || words.length > 0;

  function changeQuery(next: string) {
    setQuery(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => writeAddress({ q: next.trim(), status }), 250);
  }

  function changeStatus(next: TechCardFilter | null) {
    setStatus(next);
    clearTimeout(timer.current);
    writeAddress({ q: query.trim(), status: next });
  }

  function clearFilters() {
    setQuery("");
    setStatus(null);
    clearTimeout(timer.current);
    writeAddress({ q: "", status: null });
  }

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allShownSelected = shown.length > 0 && shown.every((item) => selected.has(item.id));
  function toggleAll(on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of shown) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  const sum = (value: number | null) => (value === null ? "—" : `${formatSum(value)} ${t.common.currency}`);
  const stateLabel = (state: CostState | RecipeState) =>
    stock ? (isCostState(state) ? tc.costStates[state] : "—") : isRecipeState(state) ? tc.recipeStates[state] : "—";

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={ClipboardList}
          action={
            <Link href="/dishes/new" className="adm-btn adm-btn-primary">
              {t.dishes.add}
            </Link>
          }
        >
          {tc.empty}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <form action="/tech-cards/print" method="get" className="grid gap-4">
      <Panel as="div" className="flex flex-wrap items-center gap-3">
        <SearchInput
          label={tc.searchLabel}
          placeholder={tc.searchPlaceholder}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          maxLength={80}
          enterKeyHint="search"
          className="w-full sm:w-auto sm:min-w-56 sm:flex-1"
          // Enter in the search box must not send the print form.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        <div role="group" aria-label={tc.filterLabel} className="adm-segmented">
          <button type="button" aria-pressed={status === null} onClick={() => changeStatus(null)}>
            {tc.filters.all}
          </button>
          {TECH_CARD_FILTERS.map((key) => (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => changeStatus(key)}>
              {tc.filters[key]}
            </button>
          ))}
        </div>
      </Panel>

      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="adm-caption tabular-nums" aria-live="polite">
          {filtering ? tc.countOf(shown.length, items.length) : tc.count(items.length)}
        </p>
        {filtering && (
          <button type="button" onClick={clearFilters} className="adm-btn adm-btn-ghost adm-btn-sm">
            <X aria-hidden="true" />
            {tc.clearFilters}
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {stock && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cost" value="1" />
              {tc.printWithCost}
            </label>
          )}
          <button type="submit" disabled={selected.size === 0} className="adm-btn adm-btn-outline adm-btn-sm">
            <Printer aria-hidden="true" />
            {selected.size > 0 ? tc.printSelected(selected.size) : tc.printPick}
          </button>
        </div>
      </div>

      {/* Ticked dishes the filter hides now still go to the print view. */}
      {[...selected]
        .filter((id) => !shownIds.has(id))
        .map((id) => (
          <input key={id} type="hidden" name="id" value={id} />
        ))}

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Filter}
            action={
              <button type="button" onClick={clearFilters} className="adm-btn adm-btn-outline">
                {tc.clearFilters}
              </button>
            }
          >
            {tc.filteredEmpty}
          </EmptyState>
        </Panel>
      ) : (
        <Panel flush className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={tc.selectAll}
                    checked={allShownSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                  />
                </th>
                <th className="px-4 py-2.5 font-medium">{tc.columns.dish}</th>
                <th className="px-4 py-2.5 font-medium">{tc.columns.state}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{tc.columns.lines}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{tc.columns.batch}</th>
                {stock && <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{tc.columns.cost100}</th>}
                {stock && <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{tc.columns.costPortion}</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id} className="adm-row">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name="id"
                      value={item.id}
                      aria-label={tc.selectOne(item.title)}
                      checked={selected.has(item.id)}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/tech-cards/${item.id}`} className="block">
                      <span className="block font-semibold text-adm-text hover:underline">{item.title}</span>
                      <span className="block text-[13px] text-adm-muted">{item.subtitle}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={STATE_TONE[item.state]} status>
                        {stateLabel(item.state)}
                      </Badge>
                      {item.verified && !isCardReady(item.state) && (
                        <Badge tone="caution">{tc.verifiedNotReady}</Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.lines || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {item.batchOutputG === null ? "—" : `${formatSum(item.batchOutputG)} ${t.common.g}`}
                  </td>
                  {stock && <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{sum(item.cost100)}</td>}
                  {stock && (
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {sum(item.costPortion)}
                      <span className="adm-caption block">{tc.portionOf(item.weight)}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </form>
  );
}
