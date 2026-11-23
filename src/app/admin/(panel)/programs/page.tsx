import type { Metadata } from "next";
import { requireOwner } from "@/lib/admin/auth";
import { listDurations, listPrograms } from "@/lib/admin/queries";
import { DurationsForm, ProgramForm } from "./Forms";

export const metadata: Metadata = { title: "Программы и цены" };

export default async function ProgramsAdminPage() {
  const { supabase } = await requireOwner();
  const [programs, durations] = await Promise.all([listPrograms(supabase), listDurations(supabase)]);

  return (
    <div className="max-w-4xl">
      <h1 className="font-serif text-4xl text-forest">Программы и цены</h1>
      <p className="mt-1 text-sm text-muted">
        Цена калорийности — за один день при заказе на самый длинный срок. Для коротких сроков к ней добавляется наценка.
      </p>

      <div className="mt-6 grid gap-5">
        {programs.map((program) => (
          <ProgramForm key={program.id} program={program} />
        ))}
      </div>

      <h2 className="mt-10 font-serif text-2xl text-forest">Сроки и наценки</h2>
      <DurationsForm durations={durations.map((d) => ({ ...d, markup_pct: Number(d.markup_pct) }))} />
    </div>
  );
}
