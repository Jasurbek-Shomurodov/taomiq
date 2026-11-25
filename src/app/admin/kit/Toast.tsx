"use client";

import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FocusEvent } from "react";
import { modalIsOpen } from "../shell/page-busy";

export type ToastMessage = {
  /** Changes with every new or updated message: restarts the hide timer. */
  id: number;
  text: string;
  /** One link, for example to the list the message is about. */
  action?: { href: string; label: string };
};

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const tabIsHidden = () => document.visibilityState !== "visible";

/**
 * A short message in the corner (bottom centre on phones) that hides itself after `duration`, for something that
 * happened in the background (a new order). Never for the result of the person's own action: that is a Notice
 * beside the form.
 *
 * Only the text is a live region (role="status", always in the page, empty while nothing is shown), so screen readers
 * announce the message and not its buttons. The timer pauses while the pointer or focus is on the message and while
 * the tab is hidden. Escape dismisses it from anywhere unless a dialog is open (the dialog's Escape wins), and so do
 * the close button and following its link. No sound. It slides in only for people who allow motion.
 */
export function Toast({
  message,
  onDismiss,
  dismissLabel,
  duration = 8000,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
  /** Accessible name of the close button, in the panel's language. */
  dismissLabel: string;
  duration?: number;
}) {
  const [paused, setPaused] = useState(false);
  const hidden = useSyncExternalStore(subscribeVisibility, tabIsHidden, () => false);
  const id = message?.id;

  useEffect(() => {
    if (id === undefined || paused || hidden) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [id, paused, hidden, duration, onDismiss]);

  const shown = id !== undefined;
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || modalIsOpen()) return;
      onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, onDismiss]);

  // A dismissed message takes its pause with it.
  const [shownId, setShownId] = useState(id);
  if (id !== shownId) {
    setShownId(id);
    if (id === undefined) setPaused(false);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
  }

  return (
    <div className="adm-toast-region">
      <div
        className="adm-toast"
        data-open={shown || undefined}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={onBlur}
      >
        {message && <BellRing aria-hidden="true" />}
        <p role="status" className="min-w-0 flex-1 text-sm font-semibold">
          {message?.text ?? ""}
        </p>
        {message?.action && (
          <Link href={message.action.href} onNavigate={onDismiss} className="adm-btn adm-btn-outline adm-btn-sm">
            {message.action.label}
          </Link>
        )}
        {message && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            title={dismissLabel}
            className="adm-btn adm-btn-ghost adm-btn-sm adm-btn-icon"
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
