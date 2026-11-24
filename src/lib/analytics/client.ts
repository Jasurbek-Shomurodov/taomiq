import type { PostHog } from "posthog-js";
import { ANALYTICS_PATH, POSTHOG_UI_HOST, isAnalyticsEnabled, posthogKey } from "./config";
import type { ClientEvent, ClientEventProperties } from "./events";

/**
 * The browser side of analytics: started once by src/instrumentation-client.ts, then used by the components through
 * track(), identifyUser() and resetAnalytics(). Every call is a no-op unless PostHog actually loaded, which needs all of:
 *  - the key is set (NEXT_PUBLIC_POSTHOG_KEY, Production only);
 *  - the public site: never on the admin host or under /admin, whose screens hold customers' personal data;
 *  - the browser does not send Do Not Track (then nothing loads at all; respect_dnt is set as well).
 *
 * posthog-js is a separate chunk, fetched once the page has loaded and the browser is idle, so it never competes with
 * the page's own scripts and images. Calls made before then wait in a short queue.
 */

type Task = (posthog: PostHog) => void;

/** off: never loads on this page (or failed to load). loading: waiting for the chunk. ready: posthog is set. */
let state: "off" | "loading" | "ready" = "off";
let posthog: PostHog | null = null;
const queue: Task[] = [];
/** Calls kept while loading; anything beyond is dropped rather than held in memory. */
const QUEUE_LIMIT = 50;

function isAdminPage(): boolean {
  const { hostname, pathname } = window.location;
  return hostname.startsWith("admin.") || pathname === "/admin" || pathname.startsWith("/admin/");
}

function doNotTrack(): boolean {
  const legacy = (window as Window & { doNotTrack?: string }).doNotTrack;
  return navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || legacy === "1";
}

function run(task: Task) {
  if (state === "ready" && posthog) {
    try {
      task(posthog);
    } catch {
      // Analytics must never break the page.
    }
  } else if (state === "loading" && queue.length < QUEUE_LIMIT) {
    queue.push(task);
  }
}

/** After the load event, when the browser is idle (or after 3 s at the latest). */
function whenIdle(callback: () => void) {
  const idle = () =>
    "requestIdleCallback" in window ? window.requestIdleCallback(callback, { timeout: 3000 }) : setTimeout(callback, 1);
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

async function load() {
  try {
    const { default: instance } = await import("posthog-js");
    instance.init(posthogKey, {
      // First-party path, rewritten to PostHog EU in next.config.ts.
      api_host: ANALYTICS_PATH,
      ui_host: POSTHOG_UI_HOST,
      // Pageviews on every App Router navigation (history_change) and the other current defaults.
      defaults: "2026-08-30",
      // Anonymous visitors get no person profile; a person exists only once identifyUser() names them.
      person_profiles: "identified_only",
      respect_dnt: true,
      capture_exceptions: true,
      autocapture: {
        // Clicks inside text marked data-ph-mask (names, phones, addresses shown back to the customer) are not
        // captured, so their text never reaches an event. The first two are PostHog's own defaults, kept.
        css_selector_ignorelist: [".ph-no-autocapture", "[data-ph-no-autocapture]", "[data-ph-mask]"],
        // Never send what a visitor typed, not even for fields that opt in.
        capture_value_css_selector_allowlist: [],
      },
      // Dead clicks stay off, also when switched on in the PostHog project: their events carry the clicked element's
      // text and use their own ignore list, separate from the one above. (An object here would turn them on; heatmaps
      // still plot click points, which carry no text.)
      capture_dead_clicks: false,
      session_recording: {
        // Every input is masked (PostHog's default, stated here so a project setting cannot turn it off), and so is
        // the text of any element marked data-ph-mask.
        maskAllInputs: true,
        maskTextSelector: "[data-ph-mask]",
        // No request or response headers or bodies in replays (form posts carry names and phones).
        recordHeaders: false,
        recordBody: false,
      },
      // Features this site does not use: never fetch their scripts.
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
    });
    posthog = instance;
    state = "ready";
    for (const task of queue.splice(0)) run(task);
  } catch {
    state = "off";
    queue.length = 0;
  }
}

/** Called once, from src/instrumentation-client.ts. */
export function startAnalytics() {
  if (!isAnalyticsEnabled || state !== "off") return;
  if (isAdminPage() || doNotTrack()) return;
  state = "loading";
  whenIdle(() => void load());
}

/** Sends one event. A no-op without PostHog (see the top of this file). */
export function track<E extends ClientEvent>(event: E, properties: ClientEventProperties<E>) {
  run((client) => client.capture(event, properties));
}

/**
 * Sign-ins this page has identified, and the ones signed out since. A sign-in is the user id plus the time of that
 * sign-in (Supabase's last_sign_in_at), so the same customer signing in again is a new one. Kept for the life of the
 * page (until a full load): Next.js keeps visited pages hidden and shows them again on Back, and an account page
 * shown again after a sign-out must not tie the browser, and whoever uses it next, back to that customer.
 */
let identified: string | null = null;
const signedOut = new Set<string>();

/**
 * Ties this browser to the signed-in customer, by their Supabase user id only: never a name, phone or email.
 * `signInAt` (the sign-in's time) tells a new sign-in from the same page shown again: each sign-in is identified at
 * most once, and never after it was signed out on this page. When `signedIn` is given and the browser was not this
 * customer yet (a new sign-in, or the first since the last sign-out), the signed_in event is sent with it, after the
 * identify, so it lands on the customer.
 */
export function identifyUser(userId: string, signInAt: string, signedIn?: ClientEventProperties<"signed_in">) {
  const key = `${userId}|${signInAt}`;
  if (key === identified || signedOut.has(key)) return;
  identified = key;
  run((client) => {
    if (client.get_distinct_id() === userId) return;
    client.identify(userId);
    if (signedIn) client.capture("signed_in", signedIn);
  });
}

/** On sign-out: forget the customer, so the next visitor on this browser is a new anonymous one. */
export function resetAnalytics() {
  if (identified) signedOut.add(identified);
  identified = null;
  run((client) => client.reset());
}
