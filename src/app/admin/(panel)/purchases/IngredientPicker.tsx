"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { foldSearchText } from "@/lib/admin/dish-status";

/** An ingredient as the picker offers it; the page builds these in the reader's language. */
export type PickerIngredient = {
  id: string;
  name: string;
  /** The names in all three languages, folded (foldSearchText). */
  search: string;
  /** The unit's short label ("кг"). */
  unitLabel: string;
  category: string;
  archived: boolean;
};

const MAX_OPTIONS = 8;

/**
 * Picks one ingredient by typing part of its name in any language (a combobox: arrow keys, Enter, Escape). Archived
 * ingredients are not offered, except the one already picked. When nothing matches, the last option offers to add
 * what was typed to the catalogue (`onAddNew`).
 */
export function IngredientPicker({
  ingredients,
  value,
  onChange,
  onAddNew,
  label,
  placeholder,
  noMatches,
  addLabel,
  archivedLabel,
  invalid,
  describedBy,
  disabled,
}: {
  ingredients: PickerIngredient[];
  value: string;
  onChange: (id: string) => void;
  onAddNew: ((typed: string) => void) | null;
  label: string;
  placeholder: string;
  noMatches: string;
  addLabel: (typed: string) => string;
  archivedLabel: string;
  invalid: boolean;
  describedBy?: string;
  disabled: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const selected = ingredients.find((item) => item.id === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const typed = query ?? "";
  const words = foldSearchText(typed).split(" ").filter(Boolean);
  const matches = ingredients
    .filter((item) => (!item.archived || item.id === value) && words.every((word) => item.search.includes(word)))
    .slice(0, MAX_OPTIONS);
  const exact = matches.some((item) => foldSearchText(item.name) === foldSearchText(typed));
  const canAdd = onAddNew !== null && typed.trim() !== "" && !exact;
  const optionCount = matches.length + (canAdd ? 1 : 0);

  function pick(itemId: string) {
    onChange(itemId);
    setQuery(null);
    setOpen(false);
  }

  function addNew() {
    const text = typed.trim();
    setQuery(null);
    setOpen(false);
    onAddNew?.(text);
  }

  function choose(index: number) {
    if (index < matches.length) pick(matches[index].id);
    else if (canAdd) addNew();
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && optionCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && optionCount > 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={query ?? selected?.name ?? ""}
        onFocus={(event) => {
          event.currentTarget.select();
          setOpen(true);
          setActive(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => (optionCount ? (i + 1) % optionCount : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => (optionCount ? (i - 1 + optionCount) % optionCount : 0));
          } else if (event.key === "Enter") {
            if (open && optionCount > 0) {
              event.preventDefault();
              choose(Math.min(active, optionCount - 1));
            }
          } else if (event.key === "Escape") {
            setOpen(false);
            setQuery(null);
          }
        }}
        className="adm-input w-full"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-adm-control border border-adm-border bg-adm-surface py-1 shadow-adm"
        >
          {matches.map((item, index) => (
            <li
              key={item.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: it runs before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item.id);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${
                index === active ? "bg-adm-accent-tint" : ""
              }`}
            >
              <span className="min-w-0 truncate font-medium text-adm-text">
                {item.name}
                {item.archived && <span className="ml-1.5 text-adm-muted">({archivedLabel})</span>}
              </span>
              <span className="shrink-0 text-[13px] text-adm-muted">
                {item.category} · {item.unitLabel}
              </span>
            </li>
          ))}
          {matches.length === 0 && !canAdd && <li className="px-3 py-2 text-sm text-adm-muted">{noMatches}</li>}
          {canAdd && (
            <li
              id={`${id}-opt-${matches.length}`}
              role="option"
              aria-selected={active === matches.length}
              onMouseDown={(event) => {
                event.preventDefault();
                addNew();
              }}
              onMouseEnter={() => setActive(matches.length)}
              className={`flex cursor-pointer items-center gap-2 border-t border-adm-border px-3 py-2 text-sm font-semibold text-adm-accent-ink ${
                active === matches.length ? "bg-adm-accent-tint" : ""
              }`}
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{addLabel(typed.trim())}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
