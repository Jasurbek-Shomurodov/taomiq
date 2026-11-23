import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes } from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Блюда" };

export default async function DishesPage() {
  const { supabase } = await requireStaff();
  const dishes = await listDishes(supabase);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-4xl text-forest">Блюда</h1>
        <Link href="/dishes/new" className="btn btn-forest">
          + Новое блюдо
        </Link>
      </div>

      {dishes.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-muted">
          Блюд пока нет. Добавьте первое — потом его можно будет поставить в меню.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-3 text-muted">Блюдо</th>
                <th className="label p-3 text-right text-muted">Порция, г</th>
                <th className="label p-3 text-right text-muted">Ккал / 100 г</th>
                <th className="label p-3 text-right text-muted">Б / Ж / У</th>
                <th className="label p-3 text-muted">Статус</th>
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
                        <span className="block font-semibold text-forest">{dish.name_ru}</span>
                        <span className="block text-xs text-muted">{dish.name_uz}</span>
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
                      {!dish.active && <Badge tone="muted">Скрыто</Badge>}
                      {dish.verified ? <Badge tone="ok">Проверено</Badge> : <Badge tone="warn">Без техкарты</Badge>}
                      {!dish.photo_url && <Badge tone="warn">Нет фото</Badge>}
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
