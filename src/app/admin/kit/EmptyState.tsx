import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Nothing to show yet: an icon, one line that says what to do next, and the action that does it. */
export function EmptyState({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="adm-empty">
      <Icon aria-hidden="true" />
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
