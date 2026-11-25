"use client";

import { Archive, CookingPot, Filter, ImageOff, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { foldSearchText } from "@/lib/admin/dish-status";
import { EQUIPMENT_STATUSES, type EquipmentStatus } from "@/lib/admin/equipment";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { SearchInput } from "../../kit/SearchField";
import { CountControl } from "./CountControl";

/** One item as the cards need it; the server page builds these. */
export type EquipmentListItem = {
  id: string;
  name: string;
  count: number;
  note: string;
  photo: string | null;
  /** "Counted 25.11.2026, 14:05 · Aziz", already worded. */
  counted: string;
  /** Name and note, folded (foldSearchText). */
  search: string;
  archived: boolean;
};

type Filters = { q: string; status: EquipmentStatus };

/** Puts the filters in the address (history.replaceState: no server round trip), so a reload shows the same list. */
function writeAddress({ q, status }: Filters) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string) => (value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
  set("q", q);
  set("status", status === "active" ? "" : status);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The register: search over names and notes, In use / Archive, then cards with the photo, the name, the note, who
 * counted last and the quick count control. Filtered here; the whole register comes from the server.
 */
export function EquipmentBrowser({
  items,
  initial,
  locale,
}: {
  items: EquipmentListItem[];
  initial: Filters;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  const [query, setQuery] = useState(initial.q);
  const [status, setStatus] = useState<EquipmentStatus>(initial.status);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: Partial<Filters>, debounce = false) {
    const filters = { q: query.trim(), status, ...next };
    if (next.q !== undefined) filters.q = next.q.trim();
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => writeAddress(filters), 250);
    else writeAddress(filters);
  }

  const words = foldSearchText(query).split(" ").filter(Boolean);
  const ofStatus = items.filter((item) => item.archived === (status === "archived"));
  const shown = ofStatus.filter((item) => words.every((word) => item.search.includes(word)));
  const filtering = words.length > 0;
  const counts = {
    active: items.filter((item) => !item.archived).length,
    archived: items.filter((item) => item.archived).length,
  };

  function clear() {
    setQuery("");
    update({ q: "" });
  }

  return (
    <>
      <Panel as="div" className="flex flex-wrap items-center gap-3">
        <SearchInput
          label={te.searchLabel}
          placeholder={te.searchPlaceholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            update({ q: event.target.value }, true);
          }}
          maxLength={80}
          enterKeyHint="search"
          className="w-full sm:w-auto sm:min-w-56 sm:flex-1"
        />
        <div role="group" aria-label={te.statusAria} className="adm-segmented">
          {EQUIPMENT_STATUSES.map((key) => (
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
              {te.statuses[key]}
              <span className="adm-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </Panel>

      {ofStatus.length > 0 && (
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="adm-caption tabular-nums" aria-live="polite">
            {filtering ? te.countOf(shown.length, ofStatus.length) : te.count(ofStatus.length)}
          </p>
          {filtering && shown.length > 0 && (
            <button type="button" onClick={clear} className="adm-btn adm-btn-ghost adm-btn-sm">
              <X aria-hidden="true" />
              {te.clearSearch}
            </button>
          )}
        </div>
      )}

      {ofStatus.length === 0 ? (
        <Panel>
          {status === "archived" ? (
            <EmptyState icon={Archive}>{te.emptyArchived}</EmptyState>
          ) : (
            <EmptyState
              icon={CookingPot}
              action={
                <Link href="/equipment/new" className="adm-btn adm-btn-primary">
                  <Plus aria-hidden="true" />
                  {te.add}
                </Link>
              }
            >
              {te.empty}
            </EmptyState>
          )}
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Filter}
            action={
              <button type="button" onClick={clear} className="adm-btn adm-btn-outline">
                {te.clearSearch}
              </button>
            }
          >
            {te.filteredEmpty}
          </EmptyState>
        </Panel>
      ) : (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))] sm:gap-4">
          {shown.map((item) => (
            <li key={item.id} className="adm-panel adm-panel-flush flex min-w-0 flex-col">
              <Link href={`/equipment/${item.id}`} tabIndex={-1} aria-hidden="true" className="block">
                <span className="relative block aspect-[4/3] bg-adm-surface-muted">
                  {item.photo ? (
                    <Image src={item.photo} alt="" fill sizes="(min-width: 40rem) 20rem, 100vw" className="object-cover" />
                  ) : (
                    <ImageOff aria-hidden="true" className="absolute inset-0 m-auto size-6 text-adm-muted" />
                  )}
                </span>
              </Link>
              <div className="grid flex-1 content-start gap-1 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/equipment/${item.id}`}
                    className="line-clamp-2 min-w-0 font-semibold leading-snug text-adm-text hover:underline"
                  >
                    {item.name}
                  </Link>
                  {item.archived && (
                    <Badge tone="neutral" className="shrink-0">
                      {te.archivedBadge}
                    </Badge>
                  )}
                </div>
                {item.note && <p className="line-clamp-2 break-words text-[13px] text-adm-muted">{item.note}</p>}
                <p className="adm-caption tabular-nums">{item.counted}</p>
                <div className="mt-2">
                  {item.archived ? (
                    <p className="text-sm tabular-nums text-adm-text">
                      <span className="text-adm-muted">{te.countLabel}: </span>
                      <b className="font-semibold">{item.count}</b>
                    </p>
                  ) : (
                    <CountControl id={item.id} name={item.name} count={item.count} locale={locale} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
