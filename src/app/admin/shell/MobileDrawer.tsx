"use client";

import { useRef, type ReactNode } from "react";
import { useModalKeyboard } from "./useModalKeyboard";

/**
 * The sidebar as a drawer from the left, below lg. It stays mounted so it can slide in and out (300 ms): the panel
 * moves while the backdrop fades, and once closed it is hidden from clicks, focus and screen readers. Open, it is
 * a modal: focus moves in, Tab stays inside, Escape and the backdrop close it, and focus returns to the menu button.
 */
export function MobileDrawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog, in the panel's language. */
  label: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useModalKeyboard({ containerRef: panelRef, active: open, onEscape: onClose });

  return (
    <div className="adm-drawer" data-open={open || undefined} aria-hidden={open ? undefined : true} inert={!open}>
      <div className="adm-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="adm-drawer-panel"
      >
        {children}
      </div>
    </div>
  );
}
