"use client";

import { Filter } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { panelPath } from "../../shell/nav";

/**
 * A category list that puts `?category=` in the address (and drops the page number), so the server page filters.
 * The other parameters (period, search, method) are kept.
 */
export function CategoryFilter({
  value,
  categories,
  label,
  allLabel,
}: {
  value: string;
  categories: { id: string; name: string }[];
  label: string;
  allLabel: string;
}) {
  const router = useRouter();
  const pathname = panelPath(usePathname());
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex min-w-0 items-center gap-2 max-sm:flex-1" aria-busy={pending || undefined}>
      <span className="sr-only">{label}</span>
      <Filter aria-hidden="true" className="size-4 shrink-0 text-adm-muted" />
      <select
        key={value}
        defaultValue={value}
        onChange={(event) => {
          const params = new URLSearchParams(window.location.search);
          if (event.target.value) params.set("category", event.target.value);
          else params.delete("category");
          params.delete("page");
          const query = params.toString();
          startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
        }}
        className="adm-input w-full sm:w-auto"
      >
        <option value="">{allLabel}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
