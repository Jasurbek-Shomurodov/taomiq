// A tiny stand-in for Supabase, for the signed-in account suite (scripts/e2e-server.mjs --account, e2e/account-signout.spec.ts).
// localhost only, in memory, no packages. It answers just what the build and the account pages ask for:
//  - Auth: GET /auth/v1/user (the fixture customer when the bearer token carries the fixture's signature, else 401),
//    POST /auth/v1/logout (204).
//  - Customer data: GET /rest/v1/profiles, POST /rest/v1/rpc/my_orders (the fixture order, then its progressOrders with
//    start dates counted from today in Tashkent, so the account's status lines are the same whatever day the suite runs),
//    POST /rest/v1/rpc/my_order_pauses (none).
//  - Catalogue (read by the build too, e.g. generateStaticParams of /[locale]/programs/[slug]): one program with one
//    calorie level, the durations and a small 30-day menu. Every other table is empty.
// The customer is made up (e2e/account-fixture.json). Nothing here is a real key or a real person.
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
        // The fixture customer has no paused days (migration 0028).
        return send(200, []);
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
