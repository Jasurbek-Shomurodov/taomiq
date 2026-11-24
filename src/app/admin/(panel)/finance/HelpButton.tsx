"use client";

import { Dialog } from "@base-ui/react/dialog";
import { CircleHelp } from "lucide-react";

const enterExit =
  "transition-[opacity,scale] duration-(--duration-base) ease-out-calm data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit";

/**
 * The "?" beside a finance figure: a dialog that says in plain words what the figure is, how it is counted and what
 * is left out (finance.help in the admin dictionaries), so the screen can be shown to an investor as it is. Escape,
 * the close button and a click outside close it; focus returns to the "?". All texts come from the caller.
 */
export function HelpButton({
  title,
  body,
  label,
  close,
}: {
  title: string;
  body: string;
  /** The button's accessible name: "Что это: Выручка". */
  label: string;
  close: string;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label={label}
        title={label}
        className="adm-no-print -my-1 inline-grid size-7 shrink-0 place-items-center rounded-full align-middle text-adm-muted transition-colors hover:text-adm-accent-ink focus-visible:text-adm-accent-ink"
      >
        <CircleHelp aria-hidden="true" className="size-4" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className={`fixed inset-0 isolate z-50 bg-adm-scrim ${enterExit}`} />
        <Dialog.Popup
          className={`fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-adm-dialog border border-adm-border bg-adm-surface p-6 text-adm-text shadow-xl outline-none data-starting-style:scale-[0.97] data-ending-style:scale-[0.97] ${enterExit}`}
        >
          <Dialog.Title className="font-sans text-lg font-semibold text-adm-text">{title}</Dialog.Title>
          <Dialog.Description className="text-sm leading-relaxed text-pretty text-adm-muted">{body}</Dialog.Description>
          <div className="flex justify-end">
            <Dialog.Close className="adm-btn adm-btn-outline">{close}</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
