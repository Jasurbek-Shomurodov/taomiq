"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** The brand's pill buttons, reshaped to the panel kit's 8 px button with its 14 px label. */
const KIT_BUTTON = "rounded-adm-btn px-4 py-0 text-sm";

/**
 * A button that asks before a change that cannot be undone. Nothing runs until the confirm button is pressed.
 *
 * - Inside a <form>: confirming submits that form (same action, same fields), as if its submit button was pressed.
 * - With `onConfirm`: confirming calls it instead.
 *
 * The dialog stays open while `pending` is true, with the confirm button disabled and showing `pendingLabel`, then
 * closes on its own; errors are shown by the caller as before. A second click on confirm never runs the action twice.
 * Without `pending` (an instant, client-only `onConfirm`), it closes as soon as `onConfirm` returns.
 *
 * `shouldAsk`, checked when the trigger is pressed, skips the dialog and runs the action at once when it returns false
 * (for a change that would lose nothing). All texts come from the caller, in the admin's language.
 */
export function ConfirmDialog({
  trigger,
  triggerClassName,
  disabled = false,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  destructive = false,
  pending: pendingProp,
  onConfirm,
  shouldAsk,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  disabled?: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  /** Shown on the confirm button while `pending`. */
  pendingLabel?: string;
  cancelLabel: string;
  destructive?: boolean;
  /** True while the confirmed action runs. Omit for an instant `onConfirm`. */
  pending?: boolean;
  onConfirm?: () => void;
  shouldAsk?: () => boolean;
}) {
  // Without `pending` the action is instant: the dialog closes as soon as it has run.
  const isAsync = pendingProp !== undefined;
  const pending = pendingProp ?? false;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Close once the confirmed action has finished (pending went true, then false).
  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (!pending && confirmed) {
      setOpen(false);
      setConfirmed(false);
    }
  }

  const busy = pending || confirmed;

  function run() {
    if (onConfirm) onConfirm();
    else triggerRef.current?.form?.requestSubmit();
  }

  function confirm() {
    // Guards a double click that lands before React re-renders the button as disabled.
    if (firedRef.current) return;
    firedRef.current = true;
    if (!isAsync) {
      run();
      setOpen(false);
      return;
    }
    setConfirmed(true);
    run();
  }

  function changeOpen(next: boolean) {
    // While the action runs, Escape and the overlay do nothing.
    if (!next && pending) return;
    if (next && shouldAsk && !shouldAsk()) {
      run();
      return;
    }
    if (next) {
      firedRef.current = false;
      setConfirmed(false);
    }
    setOpen(next);
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger ref={triggerRef} disabled={disabled} className={triggerClassName}>
        {trigger}
      </AlertDialogTrigger>
      {/* The panel kit's shapes and type: dialog radius 16, buttons 8, Manrope headings (admin.css, --adm-*). */}
      <AlertDialogContent
        onOverlayClick={() => changeOpen(false)}
        className="rounded-adm-dialog border border-adm-border bg-adm-surface text-adm-text"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="font-sans text-lg font-semibold text-adm-text">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-adm-muted">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className={`${KIT_BUTTON} border-adm-border text-adm-text`}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={confirm}
            className={destructive ? KIT_BUTTON : `${KIT_BUTTON} bg-adm-accent text-adm-on-accent hover:bg-(--adm-accent-hover)`}
          >
            {busy ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
