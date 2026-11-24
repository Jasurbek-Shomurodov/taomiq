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
    <div className="adm-page">
      <div className="grid w-full max-w-4xl gap-5">
        <p className="adm-muted">{t.programs.lead}</p>

        {programs.map((program) => (
          <ProgramForm key={program.id} program={program} locale={staff.locale} />
        ))}

        <h2 className="adm-heading mt-4 text-lg">{t.programs.durations}</h2>
        <DurationsForm durations={durations.map((d) => ({ ...d, markup_pct: Number(d.markup_pct) }))} locale={staff.locale} />
      </div>
    </div>
  );
}
