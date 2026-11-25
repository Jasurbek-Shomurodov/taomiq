import "server-only";
// The default import (module.exports): exceljs is CommonJS, and Node's ESM loader cannot see its named exports.
import ExcelJS from "exceljs";
import type { AdminDictionary } from "@/i18n/admin";
import type { PayrollRow } from "@/lib/admin/finance/math";
import type { ExportSalaryEvent, ExportSalaryRate, FinanceEntry } from "@/lib/admin/finance/queries";
import { isOrderStatus } from "@/lib/admin/orders";
import {
  PAYMENT_ROW_ORDER,
  renewalRate,
  shareOf,
  timeGrid,
  type DurationsReport,
  type OverviewReport,
  type PaymentMethodsReport,
  type ProgramsReport,
  type RenewalsReport,
  type ReportOrderRow,
  type SourcesReport,
  type StaffReport,
  type TimeReport,
} from "@/lib/admin/reports";

/*
 * The Excel workbooks of the export route (exceljs is imported here and in nothing outside this folder: see the
 * restricted-imports rule in eslint.config.mjs). Every sheet has its header row frozen and bold; money and counts are
 * number cells, days are date cells, moments are date-time cells in Tashkent time, shares are percent cells. Sheet
 * names and headers are in the owner's panel language. No customer name, phone or address is ever written: the order
 * rows carry the number, days, program, total and method only.
 */

type Workbook = InstanceType<typeof ExcelJS.Workbook>;

type CellKind = "text" | "int" | "money" | "decimal" | "percent" | "date" | "datetime";

type Column<R> = { header: string; kind: CellKind; width?: number; value: (row: R) => string | number | null };

const NUM_FMT: Record<CellKind, string | undefined> = {
  text: undefined,
  int: "#,##0",
  money: "#,##0",
  decimal: "0.0",
  percent: "0.0%",
  date: "dd.mm.yyyy",
  datetime: "dd.mm.yyyy hh:mm",
};

const WIDTH: Record<CellKind, number> = { text: 24, int: 12, money: 16, decimal: 12, percent: 12, date: 13, datetime: 17 };

/** "YYYY-MM-DD" as a date cell (UTC midnight: exceljs writes the calendar day as given). */
function dayCell(day: string | null): Date | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

const wallParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** A moment as a date-time cell showing the Tashkent wall clock (Excel cells have no time zone). */
function momentCell(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p: Record<string, number> = {};
  for (const part of wallParts.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/**
 * Characters XML 1.0 cannot carry (a workbook is XML): control characters other than tab, line feed and carriage
 * return, U+FFFE, U+FFFF, and a surrogate without its pair. A note or a tag typed with one would make Excel refuse the
 * whole file, so they are dropped from every text cell.
 */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlSafe(text: string): string {
  return text.replace(NOT_XML, "");
}

/** Excel refuses []:*?/\ in a sheet name and anything over 31 characters. */
function sheetName(name: string): string {
  return Array.from(name.replace(/[[\]:*?/\\]/g, " ").trim()).slice(0, 31).join("") || "Sheet";
}

function addSheet<R>(book: Workbook, name: string, columns: Column<R>[], rows: readonly R[]) {
  const sheet = book.addWorksheet(sheetName(name), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: xmlSafe(column.header),
    width: column.width ?? Math.max(WIDTH[column.kind], Math.min(40, Array.from(column.header).length + 2)),
    style: NUM_FMT[column.kind] ? { numFmt: NUM_FMT[column.kind] } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      columns.map((column) => {
        const value = column.value(row);
        if (value === null || value === undefined) return null;
        if (column.kind === "date") return dayCell(String(value));
        if (column.kind === "datetime") return momentCell(String(value));
        return typeof value === "string" ? xmlSafe(value) : value;
      }),
    );
  }
  return sheet;
}

/** The first sheet of every file: what it is, the period, when it was made, and how the figures are counted. */
function addAbout(
  book: Workbook,
  t: AdminDictionary,
  title: string,
  period: { from: string; to: string },
  now: Date,
  notes: string[],
) {
  const f = t.reports.file;
  const sheet = book.addWorksheet(sheetName(f.sheets.about), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [{ width: 24 }, { width: 18 }, { width: 18 }];
  sheet.addRow([title]).font = { bold: true };
  const periodRow = sheet.addRow([f.period, dayCell(period.from), dayCell(period.to)]);
  periodRow.getCell(2).numFmt = NUM_FMT.date!;
  periodRow.getCell(3).numFmt = NUM_FMT.date!;
  const createdRow = sheet.addRow([f.createdAt, momentCell(now.toISOString())]);
  createdRow.getCell(2).numFmt = NUM_FMT.datetime!;
  for (const note of [f.timeZone, ...notes]) sheet.addRow([note]);
  return sheet;
}

function newBook(): Workbook {
  const book = new ExcelJS.Workbook();
  book.creator = "TAOMIQ";
  book.created = new Date();
  return book;
}

const methodName = (method: string | null, t: AdminDictionary) =>
  method === "cash" || method === "card" || method === "transfer" ? t.finance.methods[method] : t.reports.payments.notRecorded;

const statusName = (status: string, t: AdminDictionary) => (isOrderStatus(status) ? t.orders.statuses[status] : status);

/** The order history sheet: never a name, phone or address. */
function orderColumns(t: AdminDictionary): Column<ReportOrderRow>[] {
  const c = t.reports.file.cols;
  return [
    { header: c.number, kind: "int", width: 11, value: (row) => row.number },
    { header: c.paidDay, kind: "date", value: (row) => row.paid_day },
    { header: c.paidAt, kind: "datetime", value: (row) => row.paid_at },
    { header: c.status, kind: "text", width: 16, value: (row) => statusName(row.status, t) },
    { header: c.program, kind: "text", value: (row) => row.program_name },
    { header: c.kcal, kind: "int", width: 8, value: (row) => row.kcal },
    { header: c.days, kind: "int", value: (row) => row.days },
    {
      header: c.schedule,
      kind: "text",
      width: 18,
      value: (row) => (row.weekdays_only ? t.reports.programs.weekdaysOnly : t.reports.programs.everyDay),
    },
    { header: c.startDate, kind: "date", value: (row) => row.start_date },
    { header: c.orderTotal, kind: "money", value: (row) => row.total },
    { header: c.method, kind: "text", width: 16, value: (row) => methodName(row.payment_method, t) },
    { header: c.byStaff, kind: "text", width: 12, value: (row) => (row.by_staff ? t.reports.file.yes : t.reports.file.no) },
  ];
}

export type ReportsData = {
  overview: OverviewReport;
  programs: ProgramsReport;
  durations: DurationsReport;
  time: TimeReport;
  sources: SourcesReport;
  payments: PaymentMethodsReport;
  renewals: RenewalsReport;
  staff: StaffReport;
  orders: { rows: ReportOrderRow[]; partial: boolean };
};

type Metric = { label: string; kind: CellKind; now: number | null; before?: number | null };

/** Every report of the period: a sheet per tab (Programs in three: levels, plan lengths, schedules). */
export function reportsWorkbook(data: ReportsData, period: { from: string; to: string }, t: AdminDictionary, now: Date) {
  const f = t.reports.file;
  const c = f.cols;
  const m = f.metrics;
  const book = newBook();
  const notes = [f.basis, f.noPersonal];
  if (data.orders.partial) notes.push(f.partial);
  const about = addAbout(book, t, f.title.reports, period, now, notes);
  const prevRow = about.addRow([f.previousPeriod, dayCell(data.overview.previous_from), dayCell(data.overview.previous_to)]);
  prevRow.getCell(2).numFmt = NUM_FMT.date!;
  prevRow.getCell(3).numFmt = NUM_FMT.date!;

  // Overview: one metric a row, the period, the previous one and the change.
  const cur = data.overview.current;
  const prev = data.overview.previous;
  const metrics: Metric[] = [
    { label: m.revenue, kind: "money", now: cur.revenue, before: prev.revenue },
    { label: m.orders, kind: "int", now: cur.orders, before: prev.orders },
    { label: m.avgOrder, kind: "money", now: cur.avg_order, before: prev.avg_order },
    { label: m.avgDays, kind: "decimal", now: cur.avg_days, before: prev.avg_days },
    { label: m.rationDays, kind: "int", now: cur.ration_days, before: prev.ration_days },
    { label: m.customers, kind: "int", now: cur.customers, before: prev.customers },
    { label: m.newCustomers, kind: "int", now: cur.new_customers, before: prev.new_customers },
    { label: m.returningCustomers, kind: "int", now: cur.returning_customers, before: prev.returning_customers },
    { label: m.placed, kind: "int", now: cur.placed, before: prev.placed },
    { label: m.cancelled, kind: "int", now: cur.cancelled, before: prev.cancelled },
  ];
  const overview = addSheet<Metric>(
    book,
    f.sheets.overview,
    [
      { header: c.metric, kind: "text", width: 30, value: (row) => row.label },
      { header: c.value, kind: "decimal", width: 16, value: (row) => row.now },
      { header: c.previous, kind: "decimal", width: 18, value: (row) => row.before ?? null },
      {
        header: c.change,
        kind: "percent",
        width: 14,
        value: (row) =>
          row.now === null || row.before === null || row.before === undefined || !(row.before > 0)
            ? null
            : (row.now - row.before) / row.before,
      },
    ],
    metrics,
  );
  // Each metric row in its own format (money and counts whole, the plan length with a decimal).
  metrics.forEach((metric, i) => {
    const row = overview.getRow(i + 2);
    row.getCell(2).numFmt = NUM_FMT[metric.kind]!;
    row.getCell(3).numFmt = NUM_FMT[metric.kind]!;
  });

  const revenueShare = (revenue: number) => shareOf(revenue, data.programs.revenue);
  addSheet(
    book,
    f.sheets.programs,
    [
      { header: c.program, kind: "text", value: (row) => row.program_name },
      { header: c.kcal, kind: "int", width: 8, value: (row) => row.kcal },
      { header: c.orders, kind: "int", value: (row) => row.orders },
      { header: c.rationDays, kind: "int", value: (row) => row.ration_days },
      { header: c.revenue, kind: "money", value: (row) => row.revenue },
      { header: c.share, kind: "percent", value: (row) => revenueShare(row.revenue) },
    ],
    data.programs.rows,
  );
  addSheet(
    book,
    f.sheets.durations,
    [
      { header: c.days, kind: "int", value: (row) => row.days },
      { header: c.orders, kind: "int", value: (row) => row.orders },
      { header: c.revenue, kind: "money", value: (row) => row.revenue },
      { header: c.share, kind: "percent", value: (row) => revenueShare(row.revenue) },
    ],
    data.durations.by_days,
  );
  addSheet(
    book,
    f.sheets.schedule,
    [
      {
        header: c.schedule,
        kind: "text",
        value: (row) => (row.weekdays_only ? t.reports.programs.weekdaysOnly : t.reports.programs.everyDay),
      },
      { header: c.orders, kind: "int", value: (row) => row.orders },
      { header: c.revenue, kind: "money", value: (row) => row.revenue },
      { header: c.share, kind: "percent", value: (row) => revenueShare(row.revenue) },
    ],
    data.durations.by_schedule,
  );

  // Time: a weekday a row, an hour a column, and the row's total.
  const grid = timeGrid(data.time);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  addSheet<{ day: string; values: number[] }>(
    book,
    f.sheets.time,
    [
      { header: c.weekday, kind: "text", width: 16, value: (row) => row.day },
      ...hours.map(
        (hour): Column<{ day: string; values: number[] }> => ({
          header: `${String(hour).padStart(2, "0")}:00`,
          kind: "int",
          width: 7,
          value: (row) => row.values[hour],
        }),
      ),
      { header: c.total, kind: "int", width: 9, value: (row) => row.values.reduce((sum, n) => sum + n, 0) },
    ],
    grid.map((values, i) => ({ day: t.reports.time.weekdaysLong[i], values })),
  );

  // The sources past the function's cap come summed as one last row, so the sheet adds up to the period's totals.
  type SourceLine = SourcesReport["rows"][number] & { others?: number };
  const sourceLines: SourceLine[] = data.sources.other
    ? [...data.sources.rows, { ...data.sources.other, source: null, others: data.sources.other.sources }]
    : data.sources.rows;
  addSheet<SourceLine>(
    book,
    f.sheets.sources,
    [
      {
        header: c.source,
        kind: "text",
        value: (row) =>
          row.others !== undefined
            ? t.reports.sources.others(row.others)
            : row.source === null
              ? t.reports.sources.direct
              : row.source === "staff"
                ? t.reports.sources.staff
                : row.source,
      },
      { header: c.placed, kind: "int", value: (row) => row.placed },
      { header: c.converted, kind: "int", width: 16, value: (row) => row.converted },
      { header: c.conversion, kind: "percent", value: (row) => shareOf(row.converted, row.placed) },
      { header: c.paid, kind: "int", value: (row) => row.paid },
      { header: c.revenue, kind: "money", value: (row) => row.revenue },
    ],
    sourceLines,
  );

  addSheet(
    book,
    f.sheets.payments,
    [
      { header: c.method, kind: "text", value: (row) => methodName(row.method, t) },
      { header: c.orders, kind: "int", value: (row) => row.orders },
      { header: c.revenue, kind: "money", value: (row) => row.revenue },
      { header: c.share, kind: "percent", value: (row) => shareOf(row.revenue, data.payments.revenue) },
    ],
    PAYMENT_ROW_ORDER.flatMap((method) => data.payments.rows.filter((row) => row.method === method)),
  );

  const rn = data.renewals;
  const renewals = addSheet<Metric>(
    book,
    f.sheets.renewals,
    [
      { header: c.metric, kind: "text", width: 34, value: (row) => row.label },
      { header: c.value, kind: "decimal", width: 14, value: (row) => row.now },
    ],
    [
      { label: m.ended, kind: "int", now: rn.ended },
      { label: m.renewed, kind: "int", now: rn.renewed },
      { label: m.waiting, kind: "int", now: rn.waiting },
      { label: m.early, kind: "int", now: rn.early },
      { label: m.renewalRate, kind: "percent", now: renewalRate(rn) },
      { label: m.avgGap, kind: "decimal", now: rn.avg_gap_days },
    ],
  );
  (["int", "int", "int", "int", "percent", "decimal"] as const).forEach((kind, i) => {
    renewals.getRow(i + 2).getCell(2).numFmt = NUM_FMT[kind]!;
  });

  addSheet(
    book,
    f.sheets.staff,
    [
      { header: c.name, kind: "text", value: (row) => row.name || t.reports.staff.noName },
      { header: c.inTeam, kind: "text", width: 11, value: (row) => (row.in_team ? f.yes : f.no) },
      { header: c.added, kind: "int", width: 16, value: (row) => row.added },
      { header: c.addedPaid, kind: "int", width: 16, value: (row) => row.added_paid },
      { header: c.moves, kind: "int", width: 15, value: (row) => row.moves },
      { header: c.toPaid, kind: "int", width: 16, value: (row) => row.to_paid },
      { header: c.toCancelled, kind: "int", value: (row) => row.to_cancelled },
    ],
    data.staff.rows,
  );

  addSheet(book, f.sheets.orders, orderColumns(t), data.orders.rows);
  return book;
}

/** The order history alone. */
export function ordersWorkbook(
  orders: { rows: ReportOrderRow[]; partial: boolean },
  period: { from: string; to: string },
  t: AdminDictionary,
  now: Date,
) {
  const f = t.reports.file;
  const book = newBook();
  addAbout(book, t, f.title.orders, period, now, [f.basis, f.noPersonal, ...(orders.partial ? [f.partial] : [])]);
  addSheet(book, f.sheets.orders, orderColumns(t), orders.rows);
  return book;
}

/** The ledger records of the period, oldest first. */
export function financeWorkbook(
  records: { entries: FinanceEntry[]; partial: boolean },
  period: { from: string; to: string },
  t: AdminDictionary,
  now: Date,
) {
  const f = t.reports.file;
  const c = f.cols;
  const book = newBook();
  addAbout(book, t, f.title.finance, period, now, records.partial ? [f.partial] : []);
  addSheet(
    book,
    f.sheets.records,
    [
      { header: c.date, kind: "date", value: (row) => row.entry_date },
      {
        header: c.kind,
        kind: "text",
        width: 18,
        value: (row) => (row.kind ? t.finance.kinds[row.kind] : row.entry_type),
      },
      {
        header: c.category,
        kind: "text",
        width: 26,
        value: (row) => (t.finance.categories as Record<string, string>)[row.category] ?? row.category,
      },
      { header: c.method, kind: "text", width: 14, value: (row) => methodName(row.payment_method, t) },
      { header: c.amount, kind: "money", value: (row) => row.amount },
      { header: c.counterparty, kind: "text", value: (row) => row.counterparty },
      { header: c.note, kind: "text", width: 40, value: (row) => row.note },
      { header: c.recordedAt, kind: "datetime", value: (row) => row.created_at },
    ],
    [...records.entries].reverse(),
  );
  return book;
}

/** The payroll: everyone with their balance on the last day, every rate, and the period's payments and events. */
export function payrollWorkbook(
  data: { people: PayrollRow[]; rates: ExportSalaryRate[]; events: ExportSalaryEvent[]; partial: boolean },
  period: { from: string; to: string },
  t: AdminDictionary,
  now: Date,
  balanceDay: string,
) {
  const f = t.reports.file;
  const c = f.cols;
  const p = t.finance.payroll;
  const book = newBook();
  addAbout(book, t, f.title.payroll, period, now, data.partial ? [f.partial] : []);
  const names = new Map(data.people.map((row) => [row.employee_id, row.name]));
  const nameOf = (id: string) => names.get(id) ?? "—";

  addSheet(
    book,
    f.sheets.employees,
    [
      { header: c.name, kind: "text", value: (row) => row.name },
      { header: c.jobTitle, kind: "text", width: 18, value: (row) => row.job_title },
      { header: c.joinedAt, kind: "date", width: 18, value: (row) => row.joined_at },
      { header: c.endedAt, kind: "date", width: 18, value: (row) => row.ended_at },
      { header: c.active, kind: "text", width: 10, value: (row) => (row.is_active ? f.yes : f.no) },
      { header: c.rate, kind: "money", value: (row) => row.rate_amount },
      { header: c.rateUnit, kind: "text", width: 12, value: (row) => (row.rate_unit ? p.units[row.rate_unit] : null) },
      { header: c.rateFrom, kind: "date", value: (row) => row.rate_from },
      { header: c.accrued, kind: "money", value: (row) => row.accrued },
      { header: c.bonuses, kind: "money", value: (row) => row.bonuses },
      { header: c.fines, kind: "money", value: (row) => row.fines },
      { header: c.paidOut, kind: "money", value: (row) => row.paid },
      { header: f.balanceAsOf(balanceDay), kind: "money", width: 24, value: (row) => row.balance },
    ],
    data.people,
  );
  addSheet(
    book,
    f.sheets.rates,
    [
      { header: c.employee, kind: "text", value: (row) => nameOf(row.employee_id) },
      { header: c.rateFrom, kind: "date", value: (row) => row.effective_from },
      { header: c.rate, kind: "money", value: (row) => row.amount },
      { header: c.rateUnit, kind: "text", width: 12, value: (row) => p.units[row.rate_unit] },
      { header: c.note, kind: "text", width: 40, value: (row) => row.note },
    ],
    data.rates,
  );
  addSheet(
    book,
    f.sheets.events,
    [
      { header: c.employee, kind: "text", value: (row) => nameOf(row.employee_id) },
      { header: c.date, kind: "date", value: (row) => row.event_date },
      { header: c.kind, kind: "text", width: 14, value: (row) => p.kinds[row.kind] },
      { header: c.amount, kind: "money", value: (row) => row.amount },
      { header: c.method, kind: "text", width: 14, value: (row) => (row.payment_method ? methodName(row.payment_method, t) : null) },
      { header: c.note, kind: "text", width: 40, value: (row) => row.note },
      { header: c.recordedAt, kind: "datetime", value: (row) => row.created_at },
    ],
    [...data.events].reverse(),
  );
  return book;
}
