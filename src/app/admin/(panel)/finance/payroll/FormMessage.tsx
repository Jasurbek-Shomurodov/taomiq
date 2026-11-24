import { CircleCheck, TriangleAlert } from "lucide-react";
import type { FormState } from "@/lib/admin/actions";

/** The line beside a payroll form's button: the last save's outcome, hidden while a save runs. */
export function FormMessage({ message, pending }: { message: FormState; pending: boolean }) {
  return (
    <div aria-live="polite" className="mr-auto min-w-0">
      {!pending && message.error && (
        <span role="alert" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-negative">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {message.error}
        </span>
      )}
      {!pending && message.ok && (
        <span role="status" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-positive">
          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
          {message.ok}
        </span>
      )}
    </div>
  );
}
