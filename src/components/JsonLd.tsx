/**
 * Structured data (schema.org JSON-LD) as a plain <script> tag, as the Next.js JSON-LD guide recommends.
 * `<` is escaped so text from the catalogue can never close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
