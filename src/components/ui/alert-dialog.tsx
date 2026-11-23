"use client";

// shadcn/ui alert dialog (base-nova, Base UI), restyled with the brand tokens. Admin only.
// Enter and exit are CSS transitions on Base UI's data-starting-style / data-ending-style with the site's motion
// tokens, so no animation package is needed; the global reduced-motion block in globals.css zeroes them.
import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const enterExit =
  "transition-[opacity,scale] duration-(--duration-base) ease-out-calm data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit";

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn("fixed inset-0 isolate z-50 bg-forest-deep/50", enterExit, className)}
      {...props}
    />
  );
}

/**
 * The popup with its overlay, centred, 16 px clear of the screen edges on a phone. An alert dialog ignores
 * clicks outside it by default; pass `onOverlayClick` to let a click on the overlay cancel.
 */
function AlertDialogContent({
  className,
  onOverlayClick,
  ...props
}: AlertDialogPrimitive.Popup.Props & { onOverlayClick?: () => void }) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay onClick={onOverlayClick} />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl bg-popover p-6 text-popover-foreground shadow-xl outline-none",
          "data-starting-style:scale-[0.97] data-ending-style:scale-[0.97]",
          enterExit,
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("grid gap-2", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-serif text-xl text-forest", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-pretty text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Does not close the dialog by itself: the caller decides when (for example once the action has finished). */
function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />;
}

function AlertDialogCancel({
  className,
  variant = "outline",
  ...props
}: AlertDialogPrimitive.Close.Props & Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
