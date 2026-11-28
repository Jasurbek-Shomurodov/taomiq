import type { Locale } from "@/i18n/config";

/**
 * Every analytics event the site sends, with its properties. Keep the list short (docs/plans/analytics.md → Events).
 *
 * Never put a name, phone, email, address or comment in an event: only the fields below, which describe the order,
 * never the person. A person is identified by their Supabase user id only.
 */
export type ClientEvents = {
  /** Order form: a step was shown. Phones: 1, 2, 3 (`steps`); desktop: the single page, once, as step 1. */
  order_step_viewed: { step: 1 | 2 | 3; layout: "steps" | "single" };
  /** Order form: the visitor pressed submit. */
  order_submitted: { program: string; kcal: number; days: number; weekdays_only: boolean };
  /** Order form: the action came back with an error. */
  /** network: no connection, or the request failed on the way (the form keeps every answer). */
  order_failed: { reason: "field-error" | "server" | "turnstile" | "network" };
  /** Quiz: the result was shown. */
  quiz_completed: { goal: string; program: string };
  /**
   * Calculator: a settled result was shown after the visitor changed something (the prefilled example alone never
   * counts), once per visit.
   */
  calculator_used: { kcal: number; direction: "lose" | "tone" | "keep" | "gain" };
  /** Account page: first render after signing in. */
  signed_in: { method: string };
};

export type ServerEvents = {
  /** submitOrder, after the order is saved. */
  order_placed: { program: string; kcal: number; days: number; total_uzs: number; order_number: number };
};

export type ClientEvent = keyof ClientEvents;
export type ServerEvent = keyof ServerEvents;

/** Every event also carries the page language. */
export type ClientEventProperties<E extends ClientEvent> = ClientEvents[E] & { locale: Locale };
export type ServerEventProperties<E extends ServerEvent> = ServerEvents[E] & { locale: Locale };
