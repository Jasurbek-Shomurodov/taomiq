import type { Metadata } from "next";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import { listDurations, listPrograms } from "@/lib/admin/queries";
import { DurationsForm, ProgramForm } from "./Forms";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).programs.title };
}

export default async function ProgramsAdminPage() {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const [programs, durations] = await Promise.all([listPrograms(supabase), listDurations(supabase)]);

  return (
    <div className="max-w-4xl">
      <h1 className="font-serif text-4xl text-forest">{t.programs.title}</h1>
      <p className="mt-1 text-sm text-muted">{t.programs.lead}</p>

      <div className="mt-6 grid gap-5">
        {programs.map((program) => (
          <ProgramForm key={program.id} program={program} locale={staff.locale} />
        ))}
      </div>

      <h2 className="mt-10 font-serif text-2xl text-forest">{t.programs.durations}</h2>
      <DurationsForm durations={durations.map((d) => ({ ...d, markup_pct: Number(d.markup_pct) }))} locale={staff.locale} />
    </div>
  );
}
