"use client";

import { useSyncExternalStore } from "react";
import { InlineScript } from "./InlineScript";

/**
 * The desktop sidebar's folded state, remembered per device in localStorage. The flag also lives on <html>
 * (data-adm-rail="collapsed") so CSS folds the rail from the first paint: <RailScript /> sets it while the page is
 * parsed, before React runs (see the preventing-flash guide in node_modules/next/dist/docs). React reads the same
 * flag through useSyncExternalStore; on the server and during hydration it is "open", so the markup matches and
 * the folded rail gets `inert` right after.
 */
const RAIL_STORAGE_KEY = "taomiq-admin-sidebar";
const ATTRIBUTE = "data-adm-rail";
const EVENT = "taomiq-admin-rail";

const RAIL_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(RAIL_STORAGE_KEY)})==="1")document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},"collapsed")}catch(e){}`;

/** Put once in the panel layout, ahead of the shell, so the flag is on <html> before the shell paints. */
export function RailScript() {
  return <InlineScript html={RAIL_SCRIPT} />;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

const isCollapsed = () => document.documentElement.getAttribute(ATTRIBUTE) === "collapsed";

export function useRailCollapsed(): boolean {
  return useSyncExternalStore(subscribe, isCollapsed, () => false);
}

export function setRailCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.setAttribute(ATTRIBUTE, "collapsed");
  else document.documentElement.removeAttribute(ATTRIBUTE);
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // A preference only: private windows may refuse storage.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The client path of RailScript, which runs only on a full HTML load: after a soft navigation into the panel (the
 * password sign-in redirects from /login to /), the shell mounts without it. Applies the saved setting and tells
 * the store.
 */
export function syncRailFromStorage() {
  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return;
  }
  if (collapsed === isCollapsed()) return;
  if (collapsed) document.documentElement.setAttribute(ATTRIBUTE, "collapsed");
  else document.documentElement.removeAttribute(ATTRIBUTE);
  window.dispatchEvent(new Event(EVENT));
}
