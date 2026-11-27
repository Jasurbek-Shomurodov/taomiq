import { formatSum, htmlLang, type Locale } from "@/i18n/config";
import type { AdminDictionary } from "@/i18n/admin/ru";
import { isExpenseCategory, isPaymentMethod, rowKind } from "./finance/categories";
import { formatMonth } from "./finance/month";
import { formatFeeRate, isFeeMethod } from "./finance/fees";
import { isRateUnit, isSalaryEventKind } from "./finance/payroll";
import { EDITED_FIELDS, formatDay, formatPhone, type EditedField } from "./orders";
import { isStaffRole } from "./roles";

/*
 * The audit page (/audit, owner only; docs/plans/zarkebab-feature-port.md, slice 3). The rows come from
 * public.audit_feed (migration 0019): the audit log written by the database's triggers, the month closes
 * (finance_close_log) and the order changes (order_events). Pure functions of their arguments, so the sentences can
 * be checked without a database. Not server-only: nothing here reads a secret or the clock.
 */

/**
 * The filter chips, in display order (the database's areas, plus the order changes, the purchases (0022) and the
 * equipment register (0025)).
 */
export const AUDIT_AREAS = [
  "finance",
  "payroll",
  "purchases",
  "equipment",
  "orders",
  "team",
  "settings",
  "catalog",
] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

export function isAuditArea(value: unknown): value is AuditArea {
  return typeof value === "string" && (AUDIT_AREAS as readonly string[]).includes(value);
}

/** Rows per page; the loader asks the database for one more to know whether an older page exists. */
export const AUDIT_PAGE_SIZE = 100;

/** Longest search term, in characters (the database cuts at the same length). */
export const AUDIT_SEARCH_MAX = 60;

/** A row of the feed, as the page renders it. `summary` is the database's JSON: read it defensively. */
export type AuditItem = {
  /** The feed's tie-breaking key: a source letter (l, c, o, p, e) and the row id, 20 characters. */
  key: string;
  /** timestamptz exactly as the database returned it (microseconds kept: it is the paging cursor). */
  at: string;
  actor: string | null;
  actorName: string;
  area: AuditArea;
  action: string;
  subject: string;
  summary: Record<string, unknown>;
  /** Whether the record the row links to still exists. */
  targetExists: boolean;
};

/** "Older" paging: the rows before this one. */
export type AuditCursor = { before: string; key: string };

const AT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const KEY_RE = /^[lcope]\d{19}$/;

/** The cursor from the address, or null when either half is missing or malformed (the newest page then). */
export function parseAuditCursor(before: string | undefined, key: string | undefined): AuditCursor | null {
  if (!before || !key || before.length > 40 || !AT_RE.test(before) || !KEY_RE.test(key)) return null;
  return { before, key };
}

/** The search term as it is sent: at most AUDIT_SEARCH_MAX characters (never splitting one), trimmed. */
export function cleanAuditSearch(raw: string): string {
  return Array.from(raw.slice(0, AUDIT_SEARCH_MAX * 4))
    .slice(0, AUDIT_SEARCH_MAX)
    .join("")
    .trim();
}

/** "14:05": the time of a row in Tashkent. */
export function formatAuditTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(locale === "ru" ? "ru-RU" : htmlLang[locale], {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** Who made the change: the name kept at the time, else "staff" (an account without a name) or "system". */
export function auditActor(item: Pick<AuditItem, "actor" | "actorName">, t: AdminDictionary): string {
  if (item.actorName.trim()) return item.actorName.trim();
  return item.actor ? t.audit.actorStaff : t.audit.actorSystem;
}

/** The table part of the subject ("finance_entries:…" → "finance_entries"). */
function subjectTable(subject: string): string {
  const at = subject.indexOf(":");
  return at < 0 ? subject : subject.slice(0, at);
}

function subjectId(subject: string): string {
  const at = subject.indexOf(":");
  return at < 0 ? "" : subject.slice(at + 1);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The page a row opens, or null when its record is gone (a deleted ledger entry, a removed team member) or the row
 * names nothing that has a page.
 */
export function auditHref(item: AuditItem): string | null {
  if (!item.targetExists) return null;
  const s = item.summary;
  switch (subjectTable(item.subject)) {
    case "finance_entries": {
      const day = str(s.entry_date);
      return day && DAY_RE.test(day) ? `/finance/records?m=${day.slice(0, 7)}` : "/finance/records";
    }
    case "finance_salary_events":
    case "finance_salary_rates":
    case "finance_employees": {
      const id = str(s.employee_id);
      return id && UUID_RE.test(id) ? `/finance/payroll/${id}` : null;
    }
    case "finance_month_closes":
      return "/finance/close";
    case "staff":
    case "staff_requests":
      return "/team";
    case "settings":
      return "/settings";
    case "programs":
    case "program_variants":
    case "durations":
      return "/programs";
    case "orders": {
      const id = subjectId(item.subject);
      return UUID_RE.test(id) ? `/orders/${id}` : null;
    }
    case "purchases": {
      const id = subjectId(item.subject);
      return UUID_RE.test(id) ? `/purchases/${id}` : null;
    }
    case "equipment": {
      const id = subjectId(item.subject);
      return UUID_RE.test(id) ? `/equipment/${id}` : null;
    }
    default:
      return null;
  }
}

/** A row in words: the title (what happened to what) and its details, in the reader's language. */
export type AuditLine = {
  title: string;
  /** Short facts shown on one line: amount, day, method, role. */
  facts: string[];
  /** Longer lines, each on its own: old → new values, a reason. */
  notes: string[];
};

type Ctx = { t: AdminDictionary; locale: Locale };

function money(value: unknown, { t }: Ctx): string | null {
  const n = num(value);
  return n === null ? null : `${formatSum(n)} ${t.common.currency}`;
}

function day(value: unknown, { locale }: Ctx): string | null {
  const v = str(value);
  return v && DAY_RE.test(v) ? formatDay(v, locale) : v;
}

function method(value: unknown, { t }: Ctx): string {
  return isPaymentMethod(value) ? t.finance.methods[value] : t.audit.details.noMethod;
}

function categoryName(category: unknown, { t }: Ctx): string {
  if (isExpenseCategory(category)) return t.finance.categories[category];
  if (category === "investor_support" || category === "other_income") return t.finance.categories[category];
  return str(category) ?? "—";
}

/** The kind of a ledger row, with its category for an expense: "Расход — Аренда", "Деньги инвестора". */
function entryWhat(s: Record<string, unknown>, ctx: Ctx): string {
  const { t } = ctx;
  const kind = rowKind(String(s.entry_type ?? ""), String(s.category ?? ""));
  if (kind === "expense") return `${t.finance.kinds.expense} — ${categoryName(s.category, ctx)}`;
  if (kind) return t.finance.kinds[kind];
  return categoryName(s.category, ctx);
}

function shown(value: unknown, { t }: Ctx): string {
  return value === true ? t.audit.details.shown : value === false ? t.audit.details.hidden : "—";
}

/** One field's value in a change line. */
function fieldValue(field: string, value: unknown, ctx: Ctx): string {
  const { t } = ctx;
  const d = t.audit.details;
  if (value === undefined || value === null) return d.empty;
  switch (field) {
    case "amount":
    case "price_per_day":
      return money(value, ctx) ?? d.empty;
    case "entry_date":
    case "event_date":
    case "effective_from":
    case "joined_at":
    case "ended_at":
      return day(value, ctx) ?? d.empty;
    case "payment_method":
      return method(value, ctx);
    case "category":
      return categoryName(value, ctx);
    case "kind":
      return isSalaryEventKind(value) ? t.finance.payroll.kinds[value] : String(value);
    case "rate_unit":
      return isRateUnit(value) ? t.finance.payroll.units[value] : String(value);
    case "active":
      return shown(value, ctx);
    case "markup_pct":
      return num(value) === null ? d.empty : `${num(value)}%`;
    case "is_trial":
      return value === true ? t.order.yes : t.order.no;
    default:
      return typeof value === "string" ? value.trim() || d.empty : String(value);
  }
}

function fieldLabel(field: string, { t }: Ctx): string {
  const d = t.audit.details;
  const labels: Record<string, string> = {
    amount: d.amount,
    price_per_day: d.price,
    entry_date: d.day,
    event_date: d.day,
    effective_from: d.rateFrom,
    joined_at: d.joinedAt,
    ended_at: d.endedAt,
    payment_method: d.method,
    category: d.category,
    counterparty: d.counterparty,
    kind: d.kind,
    rate_unit: d.unit,
    active: d.visibility,
    markup_pct: d.markup,
    is_trial: d.trial,
    name: d.name,
    job_title: d.jobTitle,
    days: d.daysLabel,
    buyer_name: d.buyer,
    lines: d.linesLabel,
  };
  return labels[field] ?? field;
}

/** "Цена в день: 255 000 сум → 260 000 сум" for each changed field (summary.changes), the employee link left out. */
function changeNotes(s: Record<string, unknown>, ctx: Ctx, skip: readonly string[] = []): string[] {
  const changes = record(s.changes);
  return Object.keys(changes)
    .filter((field) => !skip.includes(field) && field !== "employee_id" && field !== "entry_type")
    .map((field) => {
      const change = record(changes[field]);
      return ctx.t.audit.details.change(
        fieldLabel(field, ctx),
        fieldValue(field, change.from, ctx),
        fieldValue(field, change.to, ctx),
      );
    });
}

const SETTING_LABELS: Record<string, (t: AdminDictionary) => string> = {
  delivery_windows: (t) => t.settings.windows.label,
  order_cutoff_hour: (t) => t.settings.cutoff.label,
  cycle_anchor: (t) => t.settings.anchor.label,
  contact_phone: (t) => t.settings.phone.label,
  contact_telegram: (t) => t.settings.telegram.label,
  finance_monthly_rent: (t) => t.finance.settings.fields.monthlyRent,
  finance_break_even_daily: (t) => t.finance.settings.fields.breakEvenDaily,
  finance_tax_rate_pct: (t) => t.finance.settings.fields.taxRatePct,
  finance_backdate_days: (t) => t.finance.backdate.label,
  finance_fee_rates: (t) => t.finance.fees.label,
};

/** A settings value as the Settings screen shows it. `undefined` is a key that was not set (added or reset). */
function settingValue(key: string, value: unknown, ctx: Ctx): string {
  const { t, locale } = ctx;
  const d = t.audit.details;
  if (value === undefined || value === null) return d.notSet;
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join(", ") : d.empty;
  if (typeof value === "string") {
    if (value === "") return d.empty;
    if (key === "cycle_anchor" && DAY_RE.test(value)) return formatDay(value, locale);
    if (key === "contact_phone") return formatPhone(value);
    if (key === "contact_telegram") return `@${value}`;
    return value;
  }
  if (typeof value === "number") {
    if (key === "order_cutoff_hour") return `${String(value).padStart(2, "0")}:00`;
    if (key === "finance_tax_rate_pct") return `${value}%`;
    if (key === "finance_backdate_days") return t.finance.backdate.daysValue(value);
    if (key.startsWith("finance_")) return money(value, ctx) ?? String(value);
    return String(value);
  }
  if (typeof value === "boolean") return value ? t.order.yes : t.order.no;
  // A bank fee rate (migration 0024): { method, rate_bp, effective_from }.
  if (key === "finance_fee_rates") {
    const rate = record(value);
    const method = isFeeMethod(rate.method) ? t.finance.fees.methods[rate.method] : (str(rate.method) ?? "—");
    const bp = num(rate.rate_bp);
    const from = str(rate.effective_from);
    return [
      method,
      bp === null ? null : formatFeeRate(bp, locale),
      from && DAY_RE.test(from) ? t.finance.fees.fromDay(formatDay(from, locale)) : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const text = JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** A team member as the Team screen names them: the name, else the email. */
function member(s: Record<string, unknown>): string {
  return str(s.name) ?? str(s.email) ?? "—";
}

function roleName(value: unknown, { t }: Ctx): string {
  return isStaffRole(value) ? t.roles[value] : (str(value) ?? "—");
}

function levelName(s: Record<string, unknown>, { t }: Ctx): string {
  const kcal = num(s.kcal);
  return [str(s.program_name), kcal === null ? null : `${kcal} ${t.common.kcal}`].filter(Boolean).join(" ") || "—";
}

function compact(values: (string | null | undefined | false)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value !== "");
}

/** The sentence for a row: built from its action and summary, in the reader's language. */
export function auditLine(item: AuditItem, t: AdminDictionary, locale: Locale): AuditLine {
  const ctx: Ctx = { t, locale };
  const l = t.audit.lines;
  const d = t.audit.details;
  const s = item.summary;
  const table = subjectTable(item.subject);

  switch (table) {
    case "finance_entries": {
      const what = entryWhat(s, ctx);
      const title =
        item.action === "added" ? l.entryAdded(what) : item.action === "deleted" ? l.entryDeleted(what) : l.entryChanged(what);
      return {
        title,
        facts: compact([money(s.amount, ctx), day(s.entry_date, ctx), method(s.payment_method, ctx), str(s.counterparty)]),
        notes: changeNotes(s, ctx),
      };
    }

    case "finance_salary_events": {
      const what = isSalaryEventKind(s.kind) ? t.finance.payroll.kinds[s.kind] : (str(s.kind) ?? "—");
      const who = str(s.employee_name) ?? "—";
      const title =
        item.action === "added"
          ? l.payrollAdded(what, who)
          : item.action === "deleted"
            ? l.payrollDeleted(what, who)
            : l.payrollChanged(what, who);
      return {
        title,
        facts: compact([
          money(s.amount, ctx),
          day(s.event_date, ctx),
          s.kind === "payment" && method(s.payment_method, ctx),
        ]),
        notes: compact([str(s.note) && d.note(str(s.note)!), ...changeNotes(s, ctx)]),
      };
    }

    case "finance_salary_rates": {
      const who = str(s.employee_name) ?? "—";
      const title =
        item.action === "added"
          ? l.payrollAdded(l.rate, who)
          : item.action === "deleted"
            ? l.payrollDeleted(l.rate, who)
            : l.payrollChanged(l.rate, who);
      const amount = money(s.amount, ctx);
      const rate = amount && isRateUnit(s.rate_unit) ? t.finance.payroll.rateText[s.rate_unit](amount) : amount;
      const from = day(s.effective_from, ctx);
      return { title, facts: compact([rate, from && d.since(from)]), notes: changeNotes(s, ctx) };
    }

    case "finance_employees": {
      const who = str(s.employee_name) ?? "—";
      switch (item.action) {
        case "added": {
          const joined = day(s.joined_at, ctx);
          return { title: l.employeeAdded(who), facts: compact([str(s.job_title), joined && d.joined(joined)]), notes: [] };
        }
        case "ended": {
          const last = day(s.ended_at, ctx);
          return { title: l.employeeEnded(who), facts: compact([last && d.lastDay(last)]), notes: [] };
        }
        case "resumed": {
          const last = day(s.was_ended_at, ctx);
          return { title: l.employeeResumed(who), facts: compact([last && d.wasLastDay(last)]), notes: [] };
        }
        case "renamed":
          return { title: l.employeeRenamed(str(s.from) ?? "—", str(s.to) ?? who), facts: [], notes: [] };
        case "deleted":
          return { title: l.employeeDeleted(who), facts: [], notes: [] };
        default:
          return { title: l.employeeChanged(who), facts: [], notes: changeNotes(s, ctx) };
      }
    }

    case "finance_month_closes": {
      const monthStart = str(s.month_start);
      const month = monthStart && DAY_RE.test(monthStart) ? formatMonth(monthStart.slice(0, 7), locale) : "—";
      const result = money(s.result, ctx);
      const reason = str(s.reason);
      return {
        title: item.action === "reopened" ? l.monthReopened(month) : l.monthClosed(month),
        facts: compact([result && d.result(result)]),
        notes: compact([reason && d.reason(reason)]),
      };
    }

    case "staff": {
      const who = member(s);
      const email = str(s.name) ? str(s.email) : null;
      switch (item.action) {
        case "role_changed":
          return {
            title: l.memberRole(who),
            facts: compact([email]),
            notes: [d.change(d.roleLabel, roleName(s.from, ctx), roleName(s.to, ctx))],
          };
        case "removed":
          return { title: l.memberRemoved(who), facts: compact([email, d.role(roleName(s.role, ctx))]), notes: [] };
        case "approved":
          return { title: l.memberApproved(who), facts: compact([email, d.role(roleName(s.role, ctx))]), notes: [] };
        default:
          return { title: l.memberAdded(who), facts: compact([email, d.role(roleName(s.role, ctx))]), notes: [] };
      }
    }

    case "staff_requests": {
      const who = member(s);
      return { title: l.requestDeclined(who), facts: compact([str(s.name) ? str(s.email) : null]), notes: [] };
    }

    case "settings": {
      const key = str(s.key) ?? subjectId(item.subject);
      const name = SETTING_LABELS[key]?.(t) ?? key;
      const title =
        item.action === "added"
          ? l.settingAdded(name)
          : item.action === "deleted"
            ? l.settingDeleted(name)
            : l.settingChanged(name);
      if (s.hidden === true) return { title, facts: [d.valueHidden], notes: [] };
      return { title, facts: [], notes: [d.fromTo(settingValue(key, s.from, ctx), settingValue(key, s.to, ctx))] };
    }

    case "programs": {
      const name = str(s.name) ?? "—";
      if (item.action === "added") return { title: l.programAdded(name), facts: [shown(s.active, ctx)], notes: [] };
      if (item.action === "deleted") return { title: l.programDeleted(name), facts: [], notes: [] };
      return { title: l.programChanged(name), facts: [], notes: changeNotes(s, ctx) };
    }

    case "program_variants": {
      const name = levelName(s, ctx);
      if (item.action === "added" || item.action === "deleted") {
        const price = money(s.price_per_day, ctx);
        return {
          title: item.action === "added" ? l.levelAdded(name) : l.levelDeleted(name),
          facts: compact([price && `${d.price}: ${price}`, shown(s.active, ctx)]),
          notes: [],
        };
      }
      return { title: l.levelChanged(name), facts: [], notes: changeNotes(s, ctx) };
    }

    case "durations": {
      const days = num(s.days);
      const name = days === null ? "—" : t.audit.days(days);
      const markup = num(s.markup_pct);
      if (item.action === "added" || item.action === "deleted") {
        return {
          title: item.action === "added" ? l.durationAdded(name) : l.durationDeleted(name),
          facts: compact([markup !== null && `${d.markup}: ${markup}%`]),
          notes: [],
        };
      }
      return { title: l.durationChanged(name), facts: [], notes: changeNotes(s, ctx, ["days"]) };
    }

    case "orders": {
      const number = num(s.number);
      const n = number === null ? "—" : String(number);
      if (item.action === "cancelled") {
        const reason = str(s.reason);
        return { title: l.orderCancelled(n), facts: [], notes: compact([reason && d.reason(reason)]) };
      }
      if (item.action === "payment_changed") {
        return {
          title: l.orderPayment(n),
          facts: [],
          notes: [d.fromTo(method(s.from, ctx), method(s.to, ctx))],
        };
      }
      // edited: the names of the fields only, never their values (customer data).
      const fields = Array.isArray(s.fields) ? s.fields : [];
      const labels = EDITED_FIELDS.filter((field: EditedField) => fields.includes(field)).map(
        (field) => t.order.fields[field],
      );
      // A pause added or removed (0028) is an edit named "pause".
      if (fields.includes("pause")) labels.push(t.order.pauses.field);
      return {
        title: l.orderEdited(n),
        facts: [],
        notes: compact([labels.length > 0 && d.fields(labels.join(", ")), s.account_unlinked === true && t.order.events.accountUnlinked]),
      };
    }

    case "purchases": {
      // One line per receipt: the ledger row it writes is not listed separately (audit_feed, 0022).
      const title =
        item.action === "added" ? l.purchaseAdded : item.action === "deleted" ? l.purchaseDeleted : l.purchaseChanged;
      const lines = num(s.lines);
      const buyer = str(s.buyer_name);
      const items = Array.isArray(s.items) ? s.items.filter((x): x is string => typeof x === "string" && x !== "") : [];
      const more = lines !== null && lines > items.length ? ` ${t.purchases.history.more(lines - items.length)}` : "";
      return {
        title,
        facts: compact([
          money(s.amount, ctx),
          day(s.entry_date, ctx),
          isPaymentMethod(s.payment_method) && method(s.payment_method, ctx),
          lines !== null && d.lines(lines),
          buyer && d.buyerName(buyer),
        ]),
        notes: compact([
          item.action !== "changed" && items.length > 0 && d.items(`${items.join(", ")}${more}`),
          ...changeNotes(s, ctx),
          s.lines_changed === true && d.linesChanged,
          s.note_changed === true && d.noteChanged,
        ]),
      };
    }

    case "equipment": {
      // The register's history (0025): added, counted, confirmed, renamed, archived, restored. The name is a snapshot.
      const name = str(s.name) ?? str(s.to) ?? "—";
      const count = num(s.count);
      switch (item.action) {
        case "added":
          return { title: l.equipmentAdded(name), facts: compact([count !== null && d.countValue(count)]), notes: [] };
        case "counted":
          return {
            title: l.equipmentCounted(name),
            facts: [],
            notes: [d.change(d.countLabel, String(num(s.from) ?? "—"), String(num(s.to) ?? "—"))],
          };
        case "confirmed":
          return { title: l.equipmentConfirmed(name), facts: compact([count !== null && d.countValue(count)]), notes: [] };
        case "renamed":
          return { title: l.equipmentRenamed(str(s.from) ?? "—", str(s.to) ?? "—"), facts: [], notes: [] };
        case "archived":
          return { title: l.equipmentArchived(name), facts: compact([count !== null && d.countValue(count)]), notes: [] };
        case "restored":
          return { title: l.equipmentRestored(name), facts: compact([count !== null && d.countValue(count)]), notes: [] };
        default:
          return { title: l.other, facts: [], notes: [] };
      }
    }

    default:
      return { title: l.other, facts: [], notes: [] };
  }
}

/** Whether a row records a removal (shown in the negative tone) or an addition (positive). */
export function auditTone(item: Pick<AuditItem, "action">): "negative" | "positive" | "neutral" {
  if (item.action === "deleted" || item.action === "removed" || item.action === "cancelled" || item.action === "declined") {
    return "negative";
  }
  if (item.action === "added" || item.action === "approved") return "positive";
  return "neutral";
}
