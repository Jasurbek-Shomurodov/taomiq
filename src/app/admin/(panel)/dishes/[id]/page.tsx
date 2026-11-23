import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import type { Dish } from "@/lib/data/types";
import { DishForm } from "../DishForm";

export const metadata: Metadata = { title: "Блюдо" };

/** `/dishes/new` creates a dish; `/dishes/<id>` edits one. */
export default async function DishPage({ params }: PageProps<"/admin/dishes/[id]">) {
  const { id } = await params;
  const { supabase } = await requireStaff();

  let dish: Dish | null = null;
  if (id !== "new") {
    const { data } = await supabase.from("dishes").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    dish = data as Dish;
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dishes" className="text-sm text-muted hover:text-forest">
        ← Все блюда
      </Link>
      <h1 className="mt-2 font-serif text-4xl text-forest">{dish ? dish.name_ru : "Новое блюдо"}</h1>
      <DishForm dish={dish} />
    </div>
  );
}
