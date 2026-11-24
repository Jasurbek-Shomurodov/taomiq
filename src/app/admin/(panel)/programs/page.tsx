import { Layers } from "lucide-react";
import type { Metadata } from "next";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import { listDurations, listPrograms } from "@/lib/admin/queries";
import type { Duration, Program } from "@/lib/data/types";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { DurationsForm, ProgramForm } from "./Forms";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).programs.title };
}

/** Programs and prices (owner only): one flush panel per program, then the durations, each saved on its own. */
export default async function ProgramsAdminPage() {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);

  let programs: Program[];
  let durations: Duration[];
  try {
    [programs, durations] = await Promise.all([listPrograms(supabase), listDurations(supabase)]);
  } catch (error) {
    console.error("programs failed", error instanceof Error ? error.message : error);
    return (
      <div className="adm-page">
        <Notice tone="negative" retry={{ href: "/programs", label: t.common.retry }}>
          {t.programs.loadFailed}
        </Notice>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <div className="grid w-full max-w-4xl gap-5">
        <p className="adm-muted">{t.programs.lead}</p>

        {programs.length === 0 ? (
          <Panel>
            <EmptyState icon={Layers}>{t.programs.empty}</EmptyState>
          </Panel>
        ) : (
          programs.map((program) => <ProgramForm key={program.id} program={program} locale={staff.locale} />)
        )}

        {durations.length === 0 ? (
          <Panel title={t.programs.durations}>
            <p className="adm-muted">{t.programs.noDurations}</p>
          </Panel>
        ) : (
          <DurationsForm durations={durations.map((d) => ({ ...d, markup_pct: Number(d.markup_pct) }))} locale={staff.locale} />
        )}
      </div>
    </div>
  );
}
