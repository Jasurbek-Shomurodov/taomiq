"use client";

import { Filter, ImageOff, LayoutGrid, List, Plus, UtensilsCrossed, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import {
  DISH_STATUS_FILTERS,
  DISH_VIEW_COOKIE,
  foldSearchText,
  isDishStatusFilter,
  matchesDishStatus,
  type DishStatusFilter,
  type DishView,
} from "@/lib/admin/dish-status";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { SearchInput } from "../../kit/SearchField";

/** One dish as the list needs it; the server page builds these from the dishes table. */
export type DishListItem = {
  id: string;
  /** The name in the panel's language. */
  title: string;
  /** The Russian name (or the Latin one when the panel is Russian). */
  subtitle: string;
  /** The names in all three languages, folded (foldSearchText). */
  search: string;
  photo_url: string | null;
  weight: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  active: boolean;
  verified: boolean;
};

/** A year: the view is a convenience, nothing breaks when it expires. */
const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Puts the filters in the browser address (history.replaceState: Next.js updates useSearchParams, no fetch). */
function writeAddress({ q, status }: { q: string; status: DishStatusFilter | null }) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  if (status) url.searchParams.set("status", status);
  else url.searchParams.delete("status");
  // null, as the Next.js docs do: its own state (with the __NA mark) would skip the router update.
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The dishes list: toolbar (search over the names in any language, the status filter, cards/table), a count line
 * and the dishes. The catalogue is small, so it is loaded whole and filtered here; ?q= and ?status= follow the
 * filters (the overview's dish tiles link to ?status=), so a reload or a shared link shows the same list.
 * Uses useSearchParams: the page renders it inside <Suspense>.
 */
export function DishesBrowser({
  dishes,
  locale,
  initialView,
}: {
  dishes: DishListItem[];
  locale: Locale;
  initialView: DishView;
}) {
  const t = getAdminDictionary(locale);
  const searchParams = useSearchParams();
  const statusParam = searchParams.get("status") ?? "";
  const urlStatus = isDishStatusFilter(statusParam) ? statusParam : null;
  const urlQuery = searchParams.get("q") ?? "";

  // The filters are state; the address follows them (history.replaceState: no server round trip). The box keeps
  // what is typed, spaces and all; the address gets the trimmed term, a moment after typing stops.
  const [query, setQuery] = useState(urlQuery);
  const [status, setStatus] = useState<DishStatusFilter | null>(urlStatus);
  // `seen` is the address as last rendered, `written` what this component last put there. The router applies a
  // replaceState a little later (in a transition), so an address that is new but is what we wrote is our own echo;
  // one that is neither came from outside (a link, Back) and replaces the filters.
  const [seen, setSeen] = useState({ q: urlQuery, status: urlStatus });
  const [written, setWritten] = useState({ q: urlQuery, status: urlStatus });
  if (urlQuery !== seen.q || urlStatus !== seen.status) {
    setSeen({ q: urlQuery, status: urlStatus });
    if (urlQuery !== written.q || urlStatus !== written.status) {
      setWritten({ q: urlQuery, status: urlStatus });
      setQuery(urlQuery);
      setStatus(urlStatus);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function write(next: { q: string; status: DishStatusFilter | null }) {
    setWritten(next);
    writeAddress(next);
  }

  function changeQuery(next: string) {
    setQuery(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => write({ q: next.trim(), status }), 250);
  }

  function changeStatus(next: DishStatusFilter | null) {
    setStatus(next);
    clearTimeout(timer.current);
    write({ q: query.trim(), status: next });
  }

  const [view, setView] = useState<DishView>(initialView);

  const words = foldSearchText(query).split(" ").filter(Boolean);
  const shown = dishes.filter(
    (dish) =>
      (!status || matchesDishStatus(dish, status)) &&
      words.every((word) => dish.search.includes(word)),
  );
  const filtering = status !== null || words.length > 0;

  function changeView(next: DishView) {
    setView(next);
    document.cookie = `${DISH_VIEW_COOKIE}=${next}; Path=/; Max-Age=${VIEW_COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  function clearFilters() {
    setQuery("");
    setStatus(null);
    clearTimeout(timer.current);
    write({ q: "", status: null });
  }

  return (
    <>
      <Panel as="div" className="flex flex-wrap items-center gap-3">
        <SearchInput
          label={t.dishes.searchLabel}
          placeholder={t.dishes.searchPlaceholder}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          maxLength={80}
          enterKeyHint="search"
          className="w-full sm:w-auto sm:min-w-56 sm:flex-1"
        />
        <label className="flex min-w-0 items-center gap-2 max-sm:flex-1">
          <span className="sr-only">{t.dishes.statusLabel}</span>
          <Filter aria-hidden="true" className="size-4 shrink-0 text-adm-muted" />
          <select
            value={status ?? ""}
            onChange={(event) => changeStatus(isDishStatusFilter(event.target.value) ? event.target.value : null)}
            className="adm-input w-full sm:w-auto"
          >
            <option value="">{t.dishes.allStatuses}</option>
            {DISH_STATUS_FILTERS.map((key) => (
              <option key={key} value={key}>
                {t.dishes.filters[key]}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={t.dishes.viewLabel} className="adm-segmented">
          <button
            type="button"
            aria-pressed={view === "cards"}
            onClick={() => changeView("cards")}
            title={t.dishes.viewCards}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
            <span className="max-sm:sr-only">{t.dishes.viewCards}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            onClick={() => changeView("list")}
            title={t.dishes.viewList}
          >
            <List aria-hidden="true" className="size-4" />
            <span className="max-sm:sr-only">{t.dishes.viewList}</span>
          </button>
        </div>
      </Panel>

      {dishes.length > 0 && (
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="adm-caption tabular-nums" aria-live="polite">
            {filtering ? t.dishes.countOf(shown.length, dishes.length) : t.dishes.count(dishes.length)}
          </p>
          {filtering && shown.length > 0 && (
            // (With nothing shown, the empty state below carries this button.) A link before the scripts run (a load of the unfiltered list); after, it clears in place (Link skips
            // its navigation when the click handler prevents the default).
            <Link
              href="/dishes"
              onClick={(event) => {
                event.preventDefault();
                clearFilters();
              }}
              className="adm-btn adm-btn-ghost adm-btn-sm"
            >
              <X aria-hidden="true" />
              {t.dishes.clearFilters}
            </Link>
          )}
          <BeforeHydration>
            {/* "Add dish" lives in the top bar, which fills only once the scripts run. */}
            <Link href="/dishes/new" className="adm-btn adm-btn-outline adm-btn-sm ml-auto">
              <Plus aria-hidden="true" />
              {t.dishes.add}
            </Link>
          </BeforeHydration>
        </div>
      )}

      {dishes.length === 0 ? (
        <Panel>
          <EmptyState
            icon={UtensilsCrossed}
            action={
              <Link href="/dishes/new" className="adm-btn adm-btn-primary">
                <Plus aria-hidden="true" />
                {t.dishes.add}
              </Link>
            }
          >
            {t.dishes.empty}
          </EmptyState>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Filter}
            action={
              <button type="button" onClick={clearFilters} className="adm-btn adm-btn-outline">
                {t.dishes.clearFilters}
              </button>
            }
          >
            {t.dishes.filteredEmpty}
          </EmptyState>
        </Panel>
      ) : view === "cards" ? (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
          {shown.map((dish) => (
            <li key={dish.id} className="min-w-0">
              <Link href={`/dishes/${dish.id}`} className="adm-panel adm-panel-flush adm-card-link flex h-full flex-col">
                <span className="relative block aspect-[4/3] bg-adm-surface-muted">
                  {dish.photo_url ? (
                    <Image
                      src={dish.photo_url}
                      alt=""
                      fill
                      sizes="(min-width: 40rem) 16rem, 50vw"
                      className="object-cover"
                    />
                  ) : (
                    <ImageOff aria-hidden="true" className="absolute inset-0 m-auto size-6 text-adm-muted" />
                  )}
                </span>
                <span className="grid flex-1 content-start gap-1 p-3 sm:p-4">
                  <span className="line-clamp-2 font-semibold leading-snug text-adm-text">{dish.title}</span>
                  <span className="truncate text-[13px] text-adm-muted">{dish.subtitle}</span>
                  <span className="mt-1 text-[13px] tabular-nums text-adm-text">
                    <b className="font-semibold">
                      {dish.kcal} {t.common.kcal}
                    </b>{" "}
                    <span className="text-adm-muted">{t.dishes.per100}</span>
                    <span className="block text-adm-muted">
                      {t.common.p} {dish.protein} · {t.common.f} {dish.fat} · {t.common.c} {dish.carbs}
                    </span>
                  </span>
                  <DishBadges dish={dish} locale={locale} className="mt-2" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Panel flush className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t.dishes.dish}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.portion}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.kcal100}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.pfc}</th>
                <th className="px-4 py-2.5 font-medium">{t.dishes.status}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((dish) => (
                <tr key={dish.id} className="adm-row">
                  <td className="px-4 py-3">
                    <Link href={`/dishes/${dish.id}`} className="flex items-center gap-3">
                      <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-adm-surface-muted">
                        {dish.photo_url && (
                          <Image src={dish.photo_url} alt="" fill sizes="44px" className="object-cover" />
                        )}
                      </span>
                      <span>
                        <span className="block font-semibold text-adm-text">{dish.title}</span>
                        <span className="block text-[13px] text-adm-muted">{dish.subtitle}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{dish.weight}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{dish.kcal}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-adm-muted">
                    {dish.protein} / {dish.fat} / {dish.carbs}
                  </td>
                  <td className="px-4 py-3">
                    <DishBadges dish={dish} locale={locale} />
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

/** Hidden, card checked or not, photo missing: the same badges in both views. */
function DishBadges({ dish, locale, className = "" }: { dish: DishListItem; locale: Locale; className?: string }) {
  const t = getAdminDictionary(locale);
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {!dish.active && <Badge tone="neutral">{t.dishes.hidden}</Badge>}
      {dish.verified ? (
        <Badge tone="positive">{t.dishes.verified}</Badge>
      ) : (
        <Badge tone="caution">{t.dishes.noCard}</Badge>
      )}
      {!dish.photo_url && <Badge tone="caution">{t.dishes.noPhoto}</Badge>}
    </span>
  );
}
