"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Page content for the top bar. The panel layout cannot know the page, so a page renders <TopBarTitle>,
 * <TopBarBack>, <TopBarTabs> or <TopBarActions> anywhere in its tree and the children appear in fixed slots of the
 * bar (createPortal into elements the bar renders). The children stay in the page's React tree, so they share its
 * state, and React hides them with the page when Cache Components keeps a page in <Activity>.
 *
 * Slots render nothing on the server and fill in after hydration; the bar has a fixed height, so nothing shifts.
 * Each mounted slot is also counted (layout effect, so the count drops in the same commit that hides a page): the
 * bar shows its own title only while no page title is mounted, and the phone tab strip only while tabs are.
 */
export type SlotName = "title" | "back" | "tabs" | "actions";

const targets: Partial<Record<SlotName, HTMLElement>> = {};
const counts: Record<SlotName, number> = { title: 0, back: 0, tabs: 0, actions: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A ref callback for one of the bar's slot elements. */
function attach(name: SlotName) {
  return (element: HTMLElement | null) => {
    if (element) targets[name] = element;
    else delete targets[name];
    emit();
  };
}

/** Ref callbacks for the bar's slot elements: stable module-level functions, so React attaches each once. */
export const attachTitleSlot = attach("title");
export const attachBackSlot = attach("back");
export const attachTabsSlot = attach("tabs");
export const attachActionsSlot = attach("actions");

/** For the bar: whether a page currently fills this slot. */
export function useSlotFilled(name: SlotName): boolean {
  return useSyncExternalStore(
    subscribe,
    () => counts[name] > 0,
    () => false,
  );
}

function Slot({ name, children }: { name: SlotName; children: ReactNode }) {
  const target = useSyncExternalStore(
    subscribe,
    () => targets[name] ?? null,
    () => null,
  );
  useLayoutEffect(() => {
    counts[name] += 1;
    emit();
    return () => {
      counts[name] -= 1;
      emit();
    };
  }, [name]);
  return target ? createPortal(children, target) : null;
}

/** Replaces the bar's own title (the nav label) on detail and editor pages. */
export function TopBarTitle({ children }: { children: ReactNode }) {
  return <Slot name="title">{children}</Slot>;
}

/** A back arrow before the title. `label` is its accessible name and tooltip ("All dishes"). */
export function TopBarBack({ href, label }: { href: string; label: string }) {
  return (
    <Slot name="back">
      <Link href={href} aria-label={label} title={label} className="adm-btn adm-btn-ghost adm-btn-icon -mr-1">
        <ArrowLeft aria-hidden="true" />
      </Link>
    </Slot>
  );
}

/** A page's sections, beside the title from md up and in a strip under the bar on phones. Use .adm-tabs inside. */
export function TopBarTabs({ children }: { children: ReactNode }) {
  return <Slot name="tabs">{children}</Slot>;
}

/** The page's buttons on the right of the bar (one primary at most). */
export function TopBarActions({ children }: { children: ReactNode }) {
  return <Slot name="actions">{children}</Slot>;
}
