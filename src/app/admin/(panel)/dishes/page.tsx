import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes } from "@/lib/admin/queries";
import { localized } from "@/lib/data/localized";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).dishes.title };
}

export default async function DishesPage() {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  // listDishes() sorts by the Russian name; sort by the name shown in the panel's language instead.
  const collator = new Intl.Collator(htmlLang[staff.locale]);
  const dishes = (await listDishes(supabase))
    .map((dish) => ({ ...dish, title: localized(dish, "name", staff.locale) }))
    .sort((a, b) => collator.compare(a.title, b.title));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-4xl text-forest">{t.dishes.title}</h1>
        <Link href="/dishes/new" className="btn btn-forest">
          {t.dishes.add}
        </Link>
      </div>

      {dishes.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-muted">
          {t.dishes.empty}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-3 text-muted">{t.dishes.dish}</th>
                <th className="label p-3 text-right text-muted">{t.dishes.portion}</th>
                <th className="label p-3 text-right text-muted">{t.dishes.kcal100}</th>
                <th className="label p-3 text-right text-muted">{t.dishes.pfc}</th>
                <th className="label p-3 text-muted">{t.dishes.status}</th>
              </tr>
            </thead>
            <tbody>
              {dishes.map((dish) => (
                <tr key={dish.id} className="border-b border-line last:border-0 hover:bg-ivory">
                  <td className="p-3">
                    <Link href={`/dishes/${dish.id}`} className="flex items-center gap-3">
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-ivory-deep">
                        {dish.photo_url && (
                          <Image src={dish.photo_url} alt="" fill sizes="44px" className="object-cover" />
                        )}
                      </span>
                      <span>
                        {/* The name in the panel's language, with the Russian one underneath (or the Latin one for Russian). */}
                        <span className="block font-semibold text-forest">{dish.title}</span>
                        <span className="block text-xs text-muted">{staff.locale === "ru" ? dish.name_uz : dish.name_ru}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="p-3 text-right tabular-nums">{dish.default_weight_g}</td>
                  <td className="p-3 text-right tabular-nums">{Number(dish.kcal_100)}</td>
                  <td className="p-3 text-right tabular-nums text-muted">
                    {Number(dish.protein_100)} / {Number(dish.fat_100)} / {Number(dish.carbs_100)}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {!dish.active && <Badge tone="muted">{t.dishes.hidden}</Badge>}
                      {dish.verified ? (
                        <Badge tone="ok">{t.dishes.verified}</Badge>
                      ) : (
                        <Badge tone="warn">{t.dishes.noCard}</Badge>
                      )}
                      {!dish.photo_url && <Badge tone="warn">{t.dishes.noPhoto}</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const tones = {
    ok: "bg-sage/40 text-forest",
    warn: "bg-danger/10 text-danger",
    muted: "bg-ivory-deep text-muted",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
