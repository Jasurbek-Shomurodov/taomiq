/**
 * Questions as an accordion of native <details>: works without JavaScript, the answer opens with an
 * animated height where the browser supports it (globals.css, details.faq). Used on the home page and /faq.
 */
export function FaqList({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="max-w-3xl divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.q} className="faq group">
          {/* Padding lives on the summary so the whole 56 px+ row is the tap target. */}
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-semibold text-forest">
            {item.q}
            <span
              className="text-gold-ink transition-transform duration-(--duration-base) ease-out-calm group-open:rotate-45"
              aria-hidden
            >
              +
            </span>
          </summary>
          <p className="pb-5 leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
