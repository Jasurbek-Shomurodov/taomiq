import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { DishForm } from "../DishForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).dish.title };
}

/** `/dishes/new` creates a dish; `/dishes/<id>` edits one. */
export default async function DishPage({ params }: PageProps<"/admin/dishes/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);

  let dish: Dish | null = null;
  if (id !== "new") {
    const { data } = await supabase.from("dishes").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    dish = data as Dish;
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dishes" className="text-sm text-muted hover:text-forest">
        {t.dish.back}
      </Link>
      <h1 className="mt-2 font-serif text-4xl text-forest">
        {dish ? localized(dish, "name", staff.locale) : t.dish.newTitle}
      </h1>
      <DishForm dish={dish} locale={staff.locale} />
    </div>
  );
}
