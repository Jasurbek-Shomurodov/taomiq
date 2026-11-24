import { ChevronDown, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/admin/orders";
import {
  formatDate,
  isStaffRole,
  listAccessRequests,
  listTeam,
  type AccessRequest,
  type TeamMember,
} from "@/lib/admin/team";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { RemoveAction, RequestActions } from "./TeamControls";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).team.title };
}

/**
 * Who can use the back office and who is asking to (migration 0008). Owner only: emails are personal data.
 * Waiting requests on top, then the team, then the declined ones folded away. The email identifies a person
 * everywhere here; the name is what their account says, which they can change, so it is only a secondary line.
 * Everything marked data-ph-mask is kept out of session replays, should analytics ever run on this host.
 */
export default async function TeamPage() {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);

  let data: { waiting: AccessRequest[]; declined: AccessRequest[]; team: TeamMember[] } | null = null;
  try {
    const [requests, team] = await Promise.all([listAccessRequests(supabase), listTeam(supabase)]);
    data = { ...requests, team };
  } catch (error) {
    console.error("team page failed", error instanceof Error ? error.message : error);
  }

  if (!data) {
    return (
      <div className="adm-page">
        <Notice tone="negative" retry={{ href: "/team", label: t.common.retry }}>
          {t.team.loadFailed}
        </Notice>
      </div>
    );
  }

  const { waiting, declined } = data;

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.team.lead}</p>
      <Notice tone="info">{t.team.grants}</Notice>

      <Panel flush title={t.team.waiting} actions={waiting.length > 0 ? <Badge tone="accent">{waiting.length}</Badge> : null}>
        {waiting.length === 0 ? (
          <EmptyState icon={UserCheck} title={t.team.waitingEmpty}>
            {t.team.waitingEmptyText}
          </EmptyState>
        ) : (
          <ul>
            {waiting.map((request) => (
              <RequestRow key={request.user_id} request={request} locale={locale} t={t} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel flush title={t.team.members}>
        <ul>
          {data.team.map((member) => (
            <li
              key={member.user_id}
              className="adm-row flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div className="min-w-0 flex-1" data-ph-mask>
                <p className="adm-truncate font-semibold text-adm-text">{member.email || t.team.noEmail}</p>
                <p className="adm-caption">
                  {[member.name, t.team.since(formatDate(member.created_at, locale))].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                {member.user_id === staff.user_id && <span className="adm-caption">{t.team.you}</span>}
                <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                  {isStaffRole(member.role) ? t.roles[member.role] : member.role}
                </Badge>
                {member.role !== "owner" && (
                  <RemoveAction userId={member.user_id} email={member.email || t.team.noEmail} locale={locale} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {declined.length > 0 && (
        <details className="adm-panel adm-panel-flush group [&:not([open])>summary]:border-b-0">
          <summary className="adm-panel-head min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <h2 className="adm-heading">{t.team.declined(declined.length)}</h2>
            <ChevronDown aria-hidden="true" className="size-4 text-adm-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul>
            {declined.map((request) => (
              <RequestRow key={request.user_id} request={request} locale={locale} t={t} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RequestRow({ request, locale, t }: { request: AccessRequest; locale: Locale; t: AdminDictionary }) {
  return (
    <li className="adm-row flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0 flex-1" data-ph-mask>
        <p className="adm-truncate font-semibold text-adm-text">{request.email}</p>
        <p className="adm-caption">
          {[request.name && t.team.nameFromAccount(request.name), t.team.asked(formatDateTime(request.created_at, locale))]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <RequestActions
        userId={request.user_id}
        email={request.email}
        waiting={request.status === "pending"}
        locale={locale}
      />
    </li>
  );
}
