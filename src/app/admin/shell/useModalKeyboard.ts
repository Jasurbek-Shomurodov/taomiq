"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusables(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]"),
  );
}

function focusQuietly(element: HTMLElement | null | undefined) {
  try {
    element?.focus({ preventScroll: true });
  } catch {
    element?.focus();
  }
}

/**
 * Keyboard rules of a modal surface (the phone drawer): while `active`, focus moves in, Tab stays inside and
 * Escape calls `onEscape`; on close focus returns to what had it before (the menu button). Returns the
 * container's onKeyDown handler.
 */
export function useModalKeyboard({
  containerRef,
  active,
  onEscape,
}: {
  containerRef: RefObject<HTMLElement | null>;
  active: boolean;
  onEscape: () => void;
}) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      focusQuietly(focusables(container)[0] ?? container);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previous?.isConnected) focusQuietly(previous);
    };
  }, [active, containerRef]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(containerRef.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusQuietly(items[items.length - 1]);
    } else if (!event.shiftKey && (index === -1 || index === items.length - 1)) {
      event.preventDefault();
      focusQuietly(items[0]);
    }
  };
}
