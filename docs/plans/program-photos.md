# Plan · Program photos

Status: planned 24 Nov 2026, not built. Research: the back-office comparison of 24 Nov 2026 (PrivateCRM, Bottle) and [us-eu-features.md](us-eu-features.md).

## Goal and user flow

Each program (LIGHT, BALANCE, PROTEIN) gets one cover photo, uploaded by the owner on **Programs and prices**. The site shows it on the home page program cards and at the top of the program page. A program with no photo looks exactly as it does today; nothing is ever shown as a placeholder.

1. Owner opens `/programs` in the back office, picks a photo in a program's card. The browser downscales it and uploads it at once; a preview appears.
2. Owner presses **Save**. The site shows the photo after the catalogue cache is refreshed (the existing `updateTag(CATALOG_TAG)`).
3. **Remove photo** clears it; Save makes the site go back to the text-only card.

Out of scope here (candidates for a later plan): a gallery of several photos, "who it is for" bullets, badges, a price preview grid, dated price changes. The durations and markup editor already exists at the bottom of the page.

## Architecture

| Piece | Where |
|---|---|
| Shared photo picker (resize, upload, preview, remove) | new `src/app/admin/kit/PhotoField.tsx`, extracted from `DishForm.tsx` |
| Program card: photo field above the taglines | `src/app/admin/(panel)/programs/Forms.tsx` |
| Save: accept `photo_url`, delete the replaced file | `saveProgram` in `src/lib/admin/actions.ts` |
| Type | `Program.photo_url: string \| null` in `src/lib/data/types.ts`; `null` in `src/lib/data/demo.ts` |
| Home page program cards | `src/app/[locale]/page.tsx` (the `#programs` section) |
| Program page | `src/app/[locale]/programs/[slug]/page.tsx` |
| Structured data | `src/lib/structured-data.ts`: `image` on the program's Product, only when a photo exists |

- `PhotoField` props: `bucket`, `name` (the hidden input), `defaultUrl`, `aspect` (CSS aspect ratio of the preview), labels from the admin dictionary. It keeps the current behaviour of `DishForm`: `createImageBitmap` → canvas → JPEG 0.85, longest side 1600 px, object name `crypto.randomUUID() + ".jpg"`, upload with the staff member's browser session. **`DishForm.tsx` is not touched in this plan**: it was being rewritten by other uncommitted work on 24 Nov 2026, so `PhotoField` copies its resize-and-upload logic and moving `DishForm` onto the shared component is a follow-up.
- `saveProgram` accepts `photo_url` only if it is empty or starts with this project's public URL for the `program-photos` bucket (`${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/program-photos/`). Anything else is rejected with a form error. This keeps arbitrary URLs out of a column the public site renders.
- When the saved URL differs from the stored one, the action removes the old object from the bucket after the row update succeeds (owner's session; a failed removal is logged and does not fail the save).
- The site reads the column through the existing `getPrograms()` (`select *`), so no query changes. Render with `next/image`; `next.config.ts` already allows this project's `/storage/v1/object/public/**`.

## Data model — one additive migration (next number in sequence)

```sql
alter table public.programs add column photo_url text;  -- null = no photo

insert into storage.buckets (id, name, public)
values ('program-photos', 'program-photos', true)
on conflict (id) do nothing;
```

Storage policies on `storage.objects`, same shape as the dish-photo ones in `0001_catalog.sql`, but **owner only** for writes, because programs are owner-only (`0003_owner_admin_roles.sql`):

- `public read program photos`: select, `anon, authenticated`, `bucket_id = 'program-photos'`
- `owner upload / update / delete program photos`: `authenticated`, `bucket_id = 'program-photos' and (select private.is_owner())`

No change to existing rows, grants or policies. Non-destructive: branch test, advisors, then production.

## Design rules

- **Photo shape:** landscape 3:2 everywhere, `object-cover`. Hint under the field: horizontal photo, at least 1600 px wide, the food in the middle (edges may be cropped on phones).
- **Home card:** photo fills the top of the card with the card's own radius; the colour tag, name, tagline and prices stay below it unchanged. All three cards keep equal height whether or not they have a photo. `sizes` set for the phone carousel (about 85vw) and the three-column grid (about 33vw); not `priority`.
- **Program page:** photo beside the heading from `md`, above the text on phones; `priority` there, since it is the largest element. The `ViewTransition` on the program name must keep working.
- **Alt text:** `{name} — {tagline}` in the page's language.
- **Admin states:** uploading (button disabled, "Uploading…"), upload failed (inline error, the previous photo stays), no photo (dashed empty box with the hint). New strings go in all three admin dictionaries (`ru`, `uz`, `uzc`).
- Brand tokens only; the admin side uses the `adm-*` classes.

## Slices

1. **Upload in the back office.** Migration, `PhotoField`, program card field, `saveProgram` validation and old-file cleanup, type and demo data. The site does not read the column yet, so `main` is unchanged for visitors. Reviewer: yes (migration and storage policies).
2. **Show on the site.** Home cards, program page, structured data. No migration. Reviewer: optional.

## Risks and open questions

- **Real photos are needed** (roadmap Track A, the photo shoot). Until they exist, slice 2 changes nothing visible. Do not upload stock photos of food the kitchen does not cook.
- An upload that is never saved leaves an orphan file in the bucket. Accepted; the files are small and the bucket is owner-only.
- The working tree had uncommitted back-office changes on 24 Nov 2026 (`orders/page.tsx`, `SearchField.tsx`, `DishesBrowser.tsx`, admin dictionaries and others). The builder must not revert or fold them in; the shipper commits only this slice's files.
- Open: should the Telegram order alert image or the Open Graph image use the program photo? Not planned; say so if wanted.
