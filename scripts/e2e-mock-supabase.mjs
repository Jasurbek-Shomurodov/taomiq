// A tiny stand-in for Supabase, for the signed-in account suite (scripts/e2e-server.mjs --account, e2e/account-signout.spec.ts).
// localhost only, in memory, no packages. It answers just what the build and the account pages ask for:
//  - Auth: GET /auth/v1/user (the fixture customer when the bearer token carries the fixture's signature, else 401),
//    POST /auth/v1/logout (204).
//  - Customer data: GET /rest/v1/profiles, POST /rest/v1/rpc/my_orders (the fixture order, then its progressOrders with
//    start dates counted from today in Tashkent, so the account's status lines are the same whatever day the suite runs),
//    POST /rest/v1/rpc/my_order_pauses and my_order_pauses_v2 (the session's pauses), pause_my_order and cancel_my_pause
//    (migration 0029). Pauses are kept in memory per session id (the access token's session_id claim), so the suites
//    and the two account projects never see each other's pauses: the default session "e2e" has none, and a session
//    whose id starts with "pause-" starts with one pause staff set on the fixture's pauseOrder (e2e/account-pauses.spec.ts).
//  - Catalogue (read by the build too, e.g. generateStaticParams of /[locale]/programs/[slug]): one program with one
//    calorie level, the durations and a small 30-day menu. Every other table is empty.
// The customer is made up (e2e/account-fixture.json). Nothing here is a real key or a real person.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";

const fixture = JSON.parse(readFileSync(new URL("../e2e/account-fixture.json", import.meta.url), "utf8"));

const user = {
  id: fixture.user.id,
  aud: "authenticated",
  role: "authenticated",
  email: fixture.user.email,
  last_sign_in_at: "2026-11-24T10:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [
    {
      id: "e2e-identity",
      identity_id: "e2e-identity",
      user_id: fixture.user.id,
      provider: "email",
      last_sign_in_at: "2026-11-24T10:00:00Z",
      identity_data: { email: fixture.user.email, sub: fixture.user.id },
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
};

const program = {
  id: "e2e-balance",
  slug: "balance",
  name: "BALANCE",
  tag_color: "#C7A86B",
  tagline_uz: "Kundalik muvozanat",
  tagline_ru: "Ежедневный баланс",
  tagline_uzc: "",
  description_uz: "Har kungi hayot uchun muvozanatli ovqatlanish.",
  description_ru: "Сбалансированное питание на каждый день.",
  description_uzc: "",
  photo_url: null,
  sort: 1,
  active: true,
  variants: [
    { id: "e2e-balance-1800", program_id: "e2e-balance", kcal: 1800, meals_per_day: 5, price_per_day: 255000, sort: 1, active: true },
  ],
};

const durations = [
  { days: 2, markup_pct: 10, is_trial: true },
  { days: 7, markup_pct: 10, is_trial: false },
  { days: 14, markup_pct: 5, is_trial: false },
  { days: 30, markup_pct: 0, is_trial: false },
];

const dish = (id, name_uz, name_ru, weight, kcal_100) => ({
  id,
  name_uz,
  name_ru,
  name_uzc: "",
  photo_url: null,
  default_weight_g: weight,
  kcal_100,
  protein_100: 10,
  fat_100: 5,
  carbs_100: 12,
  ingredients_uz: "",
  ingredients_ru: "",
  ingredients_uzc: "",
  allergens: [],
  verified: false,
  active: true,
});

const SLOT_DISHES = [
  ["breakfast", dish("e2e-oat", "Suli boʻtqasi", "Овсяная каша", 250, 110)],
  ["snack1", dish("e2e-yogurt", "Yogurt", "Йогурт", 180, 120)],
  ["lunch", dish("e2e-chicken", "Tovuq va guruch", "Курица с рисом", 350, 150)],
  ["snack2", dish("e2e-cottage", "Tvorog", "Творог", 200, 105)],
  ["dinner", dish("e2e-fish", "Baliq va sabzavot", "Рыба с овощами", 300, 105)],
];

const menu = [];
for (let day = 1; day <= 30; day++) {
  for (const [slot, d] of SLOT_DISHES) {
    menu.push({ id: `e2e-${day}-${slot}`, variant_id: program.variants[0].id, cycle_day: day, slot, dish_id: d.id, weight_g: d.default_weight_g, dish: d });
  }
}

/** The fixture's orders as my_orders() returns them: progressOrders get a start date relative to today (Tashkent). */
function myOrders() {
  const today = new Date(Date.now() + 5 * 3_600_000);
  const shifted = (days) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const progress = fixture.progressOrders.map(({ start_offset_days, ...order }) => ({
    ...order,
    start_date: shifted(start_offset_days),
    created_at: "2026-11-24T10:00:00Z",
  }));
  return [fixture.order, ...progress];
}

/** Today in Tashkent plus `days`, YYYY-MM-DD. */
function tashkentDay(days = 0) {
  const date = new Date(Date.now() + 5 * 3_600_000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The first day a customer may pause (private.customer_pause_first_day, 0029) with the default cutoff hour 14. */
function firstPauseDay() {
  return tashkentDay(new Date(Date.now() + 5 * 3_600_000).getUTCHours() < 14 ? 1 : 2);
}

/** The order the "pause-" sessions start with a staff pause on, and how many days after today that pause is. */
const PAUSE_ORDER = fixture.pauseOrder;
const STAFF_PAUSE_OFFSET = fixture.staffPauseOffsetDays;

/** session id → that session's active pauses ({ id, number, from_date, to_date, source }). */
const pausesBySession = new Map();

function sessionPauses(sessionId) {
  let list = pausesBySession.get(sessionId);
  if (!list) {
    list = sessionId.startsWith("pause-")
      ? [{ id: randomUUID(), number: PAUSE_ORDER, from_date: tashkentDay(STAFF_PAUSE_OFFSET), to_date: tashkentDay(STAFF_PAUSE_OFFSET), source: "staff" }]
      : [];
    pausesBySession.set(sessionId, list);
  }
  return list;
}

/** The session_id claim of a bearer token, "" when there is none. */
function sessionOf(token) {
  try {
    return String(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")).session_id ?? "");
  } catch {
    return "";
  }
}

/** The JSON body of a request ({} when empty or not JSON). */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** pause_my_order and cancel_my_pause, with the checks the account suite can reach (the database has them all). */
async function pauseRpc(req, name, session, send) {
  const body = await readBody(req);
  const fail = (status, code, message) => send(status, { code, details: null, hint: null, message });
  const list = sessionPauses(session);
  const first = firstPauseDay();
  if (name === "pause_my_order") {
    const order = myOrders().find((o) => o.number === Number(body.p_number));
    if (!order) return fail(404, "P0002", "not_found");
    if (!["confirmed", "paid", "active"].includes(order.status)) return fail(400, "55000", "not_pausable");
    if (typeof body.p_from !== "string" || typeof body.p_to !== "string" || body.p_to < body.p_from) {
      return fail(400, "22023", "bad_range");
    }
    if (body.p_from < first) return fail(400, "22023", "pause_too_soon");
    const pause = { id: randomUUID(), number: order.number, from_date: body.p_from, to_date: body.p_to, source: "customer" };
    list.push(pause);
    return send(200, { id: pause.id, number: order.number, end_date: null, skipped: null, max: 30 });
  }
  const index = list.findIndex((pause) => pause.id === body.p_id);
  if (index < 0) return fail(404, "P0002", "not_found");
  if (list[index].source !== "customer") return fail(403, "42501", "staff_pause");
  if (list[index].from_date < first) return fail(400, "55000", "pause_locked");
  const [removed] = list.splice(index, 1);
  return send(200, { number: removed.number, end_date: null });
}

/** PostgREST "eq." filters from the query string, e.g. ?variant_id=eq.x&cycle_day=eq.1. */
function matches(row, params) {
  for (const [key, value] of params) {
    if (!value.startsWith("eq.") || !(key in row)) continue;
    if (String(row[key]) !== value.slice(3)) return false;
  }
  return true;
}

/** Starts the mock on localhost and resolves once it listens. */
export function startMockSupabase(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const signedIn = token.split(".")[2] === fixture.tokenSignature;
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    /** A table read: an array, or one object for .single()/.maybeSingle() (406 when there is not exactly one row). */
    const rows = (list) => {
      if (!wantsObject) return send(200, list);
      if (list.length === 1) return send(200, list[0]);
      return send(406, { code: "PGRST116", details: `The result contains ${list.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    };

    switch (url.pathname) {
      case "/auth/v1/user":
        return signedIn ? send(200, user) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      case "/auth/v1/logout":
        return send(204);
      case "/rest/v1/profiles":
        return rows(signedIn ? [fixture.profile] : []);
      case "/rest/v1/rpc/my_orders":
        return send(200, signedIn ? myOrders() : []);
      case "/rest/v1/rpc/my_order_pauses":
        return send(200, signedIn ? sessionPauses(sessionOf(token)).map(({ number, from_date, to_date }) => ({ number, from_date, to_date })) : []);
      case "/rest/v1/rpc/my_order_pauses_v2":
        return send(200, signedIn ? sessionPauses(sessionOf(token)) : []);
      case "/rest/v1/rpc/pause_my_order":
      case "/rest/v1/rpc/cancel_my_pause":
        if (!signedIn) return send(401, { code: "42501", details: null, hint: null, message: "permission denied" });
        return pauseRpc(req, url.pathname.slice("/rest/v1/rpc/".length), sessionOf(token), send);
      case "/rest/v1/programs":
        return rows([program]);
      case "/rest/v1/durations":
        return rows(durations);
      case "/rest/v1/menu_items":
        return rows(menu.filter((row) => matches(row, url.searchParams)));
      case "/rest/v1/dishes":
        return rows(SLOT_DISHES.map(([, d]) => d));
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return send(200, null);
    if (url.pathname.startsWith("/rest/v1/")) return rows([]);
    return send(404, { message: `e2e mock: no ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "localhost", () => resolve(server));
  });
}
