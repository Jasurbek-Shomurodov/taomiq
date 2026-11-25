import {
  History,
  SearchX,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  Tags,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createElement, Suspense } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import {
  AUDIT_AREAS,
  AUDIT_SEARCH_MAX,
  auditActor,
  auditHref,
  auditLine,
  auditTone,
  cleanAuditSearch,
  formatAuditTime,
  isAuditArea,
  parseAuditCursor,
  type AuditArea,
  type AuditCursor,
  type AuditItem,
} from "@/lib/admin/audit";
import { loadAuditFeed } from "@/lib/admin/audit-queries";
import { requireOwner } from "@/lib/admin/auth";
import { formatDay } from "@/lib/admin/orders";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { SearchField } from "../../kit/SearchField";
import { Segmented } from "../../kit/Segmented";
import { Skeleton } from "../../kit/Skeleton";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  return { title: getAdminDictionary(staff.locale).nav.audit };
}

const BASE_PATH = "/audit";

/** The cursor's two parameters: a new search or area drops them (the result set changed). */
const CURSOR_PARAMS = ["before", "bk"] as const;

const AREA_ICONS: Record<AuditArea, LucideIcon> = {
  finance: Wallet,
  payroll: UserRound,
  purchases: ShoppingBasket,
  orders: ShoppingBag,
  team: Users,
  settings: Settings,
  catalog: Tags,
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The log's address: area, search and the paging cursor together, so each keeps the others. */
function href({ area, q, cursor }: { area: AuditArea | null; q: string; cursor?: AuditCursor | null }): string {
  const params = new URLSearchParams();
  if (area) params.set("area", area);
  if (q) params.set("q", q);
  if (cursor) {
    params.set("before", cursor.before);
    params.set("bk", cursor.key);
  }
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

type Day = { day: string; items: AuditItem[] };

/** Rows grouped by their Tashkent day, in the order they came (newest first). */
function groupByDay(items: readonly AuditItem[]): Day[] {
  const days: Day[] = [];
  for (const item of items) {
    const day = tashkentDay(item.at) ?? "";
    let group = days.at(-1);
    if (!group || group.day !== day) {
      group = { day, items: [] };
      days.push(group);
    }
    group.items.push(item);
  }
  return days;
}

/**
 * Audit (owner only; docs/plans/zarkebab-feature-port.md, slice 3): one time-ordered list of the changes to money,
 * payroll, the team, settings, catalogue prices and orders, read from public.audit_feed (migration 0019), which
 * refuses anyone but the owner. `?area=` filters by area, `?q=` searches (actor, subject, amounts, order numbers),
 * `?before=&bk=` is the cursor of an older page (100 rows a page). Each row: time, who, what in the reader's
 * language, and a link to the record while it exists.
 */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const a = t.audit;
  const params = await searchParams;
  const areaParam = one(params.area);
  const area = isAuditArea(areaParam) ? areaParam : null;
  const q = cleanAuditSearch(one(params.q) ?? "");
  const cursor = parseAuditCursor(one(params.before), one(params.bk));
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;

  let result: { items: AuditItem[]; older: AuditCursor | null } | null = null;
  try {
    result = await loadAuditFeed(supabase, { area, search: q, cursor });
  } catch (error) {
    console.error("audit feed failed", error instanceof Error ? error.message : error);
  }

  const dayTitle = (day: string) => {
    if (!day) return "—";
    const label = formatDay(day, locale);
    if (day === today) return `${a.today}, ${label}`;
    if (day === addDays(today, -1)) return `${a.yesterday}, ${label}`;
    return label;
  };

  return (
    <div className="adm-page">
      <div className="grid gap-1">
        <p className="adm-muted">{a.lead}</p>
        <p className="adm-caption">{a.since}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />}>
          <SearchField
            label={a.searchLabel}
            placeholder={a.searchPlaceholder}
            maxLength={AUDIT_SEARCH_MAX}
            reset={CURSOR_PARAMS}
            className="w-full sm:max-w-sm"
          />
        </Suspense>
        <Segmented
          label={a.areasAria}
          value={area ?? "all"}
          items={[
            { key: "all", label: a.areas.all, href: href({ area: null, q }) },
            ...AUDIT_AREAS.map((key) => ({ key, label: a.areas[key], href: href({ area: key, q }) })),
          ]}
          className="max-w-full"
        />
      </div>

      {!result ? (
        <Notice tone="negative" retry={{ href: href({ area, q, cursor }), label: t.common.retry }}>
          {a.loadFailed}
        </Notice>
      ) : result.items.length === 0 ? (
        <Panel>
          {q ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href({ area, q: "" })} className="adm-btn adm-btn-outline">
                  {a.clearSearch}
                </Link>
              }
            >
              {a.searchEmpty(q)}
            </EmptyState>
          ) : cursor ? (
            <EmptyState
              icon={History}
              action={
                <Link href={href({ area, q })} className="adm-btn adm-btn-outline">
                  {a.newest}
                </Link>
              }
            >
              {a.emptyOlder}
            </EmptyState>
          ) : area ? (
            <EmptyState
              icon={AREA_ICONS[area]}
              action={
                <Link href={href({ area: null, q })} className="adm-btn adm-btn-outline">
                  {a.showAll}
                </Link>
              }
            >
              {a.emptyArea(a.areas[area])}
            </EmptyState>
          ) : (
            <EmptyState icon={History}>{a.empty}</EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <p className="adm-caption tabular-nums" aria-live="polite">
            {a.shown(result.items.length)}
          </p>
          {groupByDay(result.items).map((day) => (
            <Panel key={day.day} flush title={dayTitle(day.day)}>
              <ul>
                {day.items.map((item) => (
                  <AuditRow key={item.key} item={item} locale={locale} t={t} />
                ))}
              </ul>
            </Panel>
          ))}
        </>
      )}

      {result && (cursor || result.older) && (
        <nav aria-label={a.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {cursor ? (
            <Link href={href({ area, q })} className="adm-btn adm-btn-outline">
              {a.newest}
            </Link>
          ) : (
            <span />
          )}
          {result.older ? (
            <Link href={href({ area, q, cursor: result.older })} className="adm-btn adm-btn-outline">
              {a.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

function AuditRow({ item, locale, t }: { item: AuditItem; locale: Locale; t: AdminDictionary }) {
  const line = auditLine(item, t, locale);
  const link = auditHref(item);
  const tone = auditTone(item);

  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span
        className={`adm-tone-${tone} mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control`}
        title={t.audit.areas[item.area]}
      >
        {createElement(AREA_ICONS[item.area], { "aria-hidden": true, className: "size-4" })}
        <span className="sr-only">{t.audit.areas[item.area]}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-semibold text-adm-text" data-ph-mask>
          {line.title}
        </p>
        {line.facts.length > 0 && (
          <p className="adm-caption break-words tabular-nums" data-ph-mask>
            {line.facts.join(" · ")}
          </p>
        )}
        {line.notes.map((note, i) => (
          <p key={i} className="adm-caption whitespace-pre-line break-words" data-ph-mask>
            {note}
          </p>
        ))}
        <p className="adm-caption mt-1 tabular-nums">
          <time dateTime={item.at}>{formatAuditTime(item.at, locale)}</time>
          {" · "}
          <span data-ph-mask>{auditActor(item, t)}</span>
        </p>
      </div>
      {link && (
        <Link
          href={link}
          className="adm-btn adm-btn-outline adm-btn-sm shrink-0"
          aria-label={t.audit.openAria(line.title)}
        >
          {t.audit.open}
        </Link>
      )}
    </li>
  );
}
