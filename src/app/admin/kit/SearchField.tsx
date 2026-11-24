"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A search box that writes ?q= to the address (router.replace, debounced), so the server page filters and the
 * search survives a reload. Clearing it removes q; any page number is dropped, since the result set changed.
 */
export function SearchField({
  label,
  placeholder,
  param = "q",
  delay = 300,
  className = "",
}: {
  /** Accessible name. */
  label: string;
  placeholder?: string;
  param?: string;
  delay?: number;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The address changed from outside (Back, a "Clear filters" link): show what it says.
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setValue(current);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const term = next.trim();
      if (term) params.set(param, term);
      else params.delete(param);
      params.delete("page");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, delay);
  }

  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-adm-muted" />
      <input
        type="search"
        value={value}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="adm-input pl-9"
      />
    </label>
  );
}
