import Link from "next/link";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes, listPrograms, menuCounts, newOrderCount } from "@/lib/admin/queries";
import { CYCLE_DAYS } from "@/lib/data/types";

export default async function AdminHome() {
  const { supabase, staff } = await requireStaff();
  const [programs, dishes, counts, newOrders] = await Promise.all([
    listPrograms(supabase),
    listDishes(supabase),
    menuCounts(supabase),
    // Orders hold personal data: only the owner sees them. A failed count never breaks the overview.
    staff.role === "owner"
      ? newOrderCount(supabase).catch((error: unknown) => {
          console.error("new order count failed", error instanceof Error ? error.message : error);
          return null;
        })
      : undefined,
  ]);

  const unverified = dishes.filter((d) => d.active && !d.verified).length;
  const noPhoto = dishes.filter((d) => d.active && !d.photo_url).length;

  return (
    <div>
      <h1 className="font-serif text-4xl text-forest">Здравствуйте{staff.name ? `, ${staff.name}` : ""}</h1>

      <div className={`mt-6 grid gap-4 ${newOrders === undefined ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {newOrders !== undefined && (
          <Stat label="Новые заказы" value={newOrders ?? "—"} href="/orders?status=new" warn={(newOrders ?? 0) > 0} />
        )}
        <Stat label="Блюд в базе" value={dishes.length} href="/dishes" />
        <Stat label="Без проверенной техкарты" value={unverified} href="/dishes" warn={unverified > 0} />
        <Stat label="Без фотографии" value={noPhoto} href="/dishes" warn={noPhoto > 0} />
      </div>

      <h2 className="mt-10 font-serif text-2xl text-forest">Заполнение меню</h2>
      <p className="mt-1 text-sm text-muted">Сколько из {CYCLE_DAYS} дней заполнено по каждой калорийности.</p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        {programs.flatMap((program) =>
          program.variants.map((variant) => {
            const done = counts.get(variant.id)?.days ?? 0;
            return (
              <Link
                key={variant.id}
                href={`/menu?variant=${variant.id}`}
                className="flex items-center gap-4 border-b border-line p-4 last:border-0 hover:bg-ivory"
              >
                <span className="h-8 w-1.5 rounded-full" style={{ background: program.tag_color }} />
                <span className="w-44 font-semibold text-forest">
                  {program.name} / <span className="tabular-nums">{variant.kcal}</span>
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-ivory-deep">
                  <span className="block h-full rounded-full bg-forest" style={{ width: `${(done / CYCLE_DAYS) * 100}%` }} />
                </span>
                <span className="w-16 text-right text-sm tabular-nums text-muted">
                  {done} / {CYCLE_DAYS}
                </span>
              </Link>
            );
          }),
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  warn = false,
}: {
  label: string;
  value: number | string;
  href: string;
  warn?: boolean;
}) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-white p-5 hover:border-forest">
      <p className="label text-muted">{label}</p>
      <p className={`mt-2 font-serif text-4xl tabular-nums ${warn ? "text-danger" : "text-forest"}`}>{value}</p>
    </Link>
  );
}
