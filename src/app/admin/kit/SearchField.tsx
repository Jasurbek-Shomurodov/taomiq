"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { panelPath } from "../shell/nav";

/**
 * The search box's look: a labelled input with the magnifier. SearchField wires it to ?q= on the server; a list
 * filtered in the browser (dishes) drives it with its own state.
 */
export function SearchInput({
  label,
  className = "",
  ...input
}: {
  /** Accessible name. */
  label: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-adm-muted" />
      <input type="search" autoComplete="off" spellCheck={false} {...input} className="adm-input pl-9" />
    </label>
  );
}

const DEFAULT_RESET = ["page"] as const;

/**
 * A search box that writes ?q= to the address (router.replace, debounced), so the server page filters and the
 * search survives a reload. Clearing it removes q; any page number is dropped, since the result set changed.
 * It is a GET form too: before the page's scripts have loaded, Enter still searches (a full load with the other
 * parameters kept). Uses useSearchParams, so put it inside <Suspense>.
 */
export function SearchField({
  label,
  placeholder,
  param = "q",
  delay = 300,
  maxLength,
  reset = DEFAULT_RESET,
  className = "",
}: {
  /** Accessible name. */
  label: string;
  placeholder?: string;
  param?: string;
  delay?: number;
  maxLength?: number;
  /** Parameters a new search drops, since the result set changed: the page number, or a paging cursor. */
  reset?: readonly string[];
  className?: string;
}) {
  const router = useRouter();
  // The browser's path (/orders), also on the server, which may see the rewritten /admin/orders.
  const pathname = panelPath(usePathname());
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `seen` is the address as last rendered, `written` the term this box last sent. When its own navigation lands
  // (current === written) the box keeps what is being typed (a trailing space, keys pressed during the round
  // trip); only an address that is neither (Back, a "Clear search" link, a tab) replaces the text.
  const [seen, setSeen] = useState(current);
  const [written, setWritten] = useState(current);
  if (current !== seen) {
    setSeen(current);
    if (current !== written) {
      setWritten(current);
      setValue(current);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function go(next: string) {
    // The address as it is now, not as of the last render: a tab clicked during the debounce stays clicked.
    const params = new URLSearchParams(window.location.search);
    const term = next.trim();
    if (term) params.set(param, term);
    else params.delete(param);
    for (const key of reset) params.delete(key);
    setWritten(term);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function update(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next), delay);
  }

  // The other parameters ride along when the form is sent without scripts (the page number is dropped).
  const kept = [...searchParams.entries()].filter(([key]) => key !== param && !reset.includes(key));

  return (
    <form
      role="search"
      action={pathname}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        go(value);
      }}
      className={className}
    >
      {kept.map(([key, v], i) => (
        <input key={`${key}-${i}`} type="hidden" name={key} value={v} />
      ))}
      <SearchInput
        label={label}
        name={param}
        value={value}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        enterKeyHint="search"
      />
    </form>
  );
}
