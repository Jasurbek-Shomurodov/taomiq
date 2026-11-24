import type { ReactNode } from "react";

/**
 * A white card on the page. `flush` drops the padding for divider rows and tables (.adm-row inside): never a card
 * inside a card. `title` and `actions` make a heading line (in a flush panel, a bordered header).
 */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  as?: "section" | "div";
  className?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const head =
    title || actions ? (
      <div className="adm-panel-head">
        <div className="min-w-0">
          {title && <h2 className="adm-heading">{title}</h2>}
          {description && <p className="adm-caption mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    ) : null;
  return (
    <Tag className={`adm-panel ${flush ? "adm-panel-flush" : ""} ${className}`} {...rest}>
      {head}
      {head && !flush ? <div className="mt-4">{children}</div> : children}
    </Tag>
  );
}
