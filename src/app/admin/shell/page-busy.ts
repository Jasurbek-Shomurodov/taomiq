/**
 * Whether a background refresh of the page (router.refresh() from shell/live.tsx) could get in someone's way. A
 * refresh keeps React state, but it re-renders the page under the person's hands, so it waits while any of these
 * holds:
 *
 *  1. A modal surface is open: a <dialog open>, or anything with role="dialog" / "alertdialog" or aria-modal that is
 *     on screen (the confirm dialogs, components/ui/alert-dialog.tsx; the phone drawer, which stays mounted but is
 *     inert and aria-hidden while closed, so it counts only when open).
 *  2. Focus is in a field someone can type into (the search box included).
 *  3. A form field in <main> holds a value other than the one the page rendered: value vs defaultValue for text
 *     fields, checked vs defaultChecked for boxes, a chosen file. Controlled React fields keep the two in step, so
 *     they are covered by 2 while being edited. Selects are not compared: a controlled select never marks a default
 *     option, which would read as "changed" for good.
 *
 * Long forms (/orders/new, the editors) are never refreshed at all: live.tsx refreshes only the dashboard and the
 * orders list.
 */
export function pageIsBusy(): boolean {
  if (typeof document === "undefined") return true;
  if (modalIsOpen()) return true;
  if (isTypingTarget(document.activeElement)) return true;

  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("main input, main textarea");
  for (const field of fields) if (isChanged(field)) return true;

  return false;
}

/** Rule 1 on its own: a dialog or the open phone drawer is on screen (it owns Escape then). */
export function modalIsOpen(): boolean {
  const modals = document.querySelectorAll<HTMLElement>(
    'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
  );
  for (const modal of modals) if (isOnScreen(modal)) return true;
  return false;
}

function isOnScreen(element: HTMLElement): boolean {
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  return element.getClientRects().length > 0;
}

const NOT_TYPED = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "hidden", "image"]);

function isTypingTarget(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return !NOT_TYPED.has(element.type) && !element.readOnly && !element.disabled;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLSelectElement) return !element.disabled;
  return element instanceof HTMLElement && element.isContentEditable;
}

function isChanged(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (field.disabled) return false;
  if (field instanceof HTMLTextAreaElement) return field.value !== field.defaultValue;
  switch (field.type) {
    case "hidden":
    case "button":
    case "submit":
    case "reset":
    case "image":
      return false;
    case "checkbox":
    case "radio":
      return field.checked !== field.defaultChecked;
    case "file":
      return (field.files?.length ?? 0) > 0;
    default:
      return field.value !== field.defaultValue;
  }
}
