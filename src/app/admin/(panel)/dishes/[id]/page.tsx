import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { DishForm } from "../DishForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).dish.title };
}

/** `/dishes/new` creates a dish; `/dishes/<id>` edits one. A full page: back to the list and Save in the top bar. */
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
    <div className="adm-page">
      <TopBarBack href="/dishes" label={t.dish.back} />
      <TopBarTitle>
        <span className="adm-truncate">{dish ? localized(dish, "name", staff.locale) : t.dish.newTitle}</span>
      </TopBarTitle>
      {/* The editor: panels (names, nutrition, photo, visibility), Save in the top bar, delete underneath. */}
      <DishForm dish={dish} locale={staff.locale} />
    </div>
  );
}
