import { ChevronDown, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/admin/orders";
import { isGrantableRole, isStaffRole, type StaffRole } from "@/lib/admin/roles";
import { formatDate, listAccessRequests, listTeam, type AccessRequest, type TeamMember } from "@/lib/admin/team";
import { Badge, type Tone } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { MemberActions, RequestActions } from "./TeamControls";

const ROLE_TONES: Record<StaffRole, Tone> = { owner: "accent", manager: "info", admin: "neutral" };

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).team.title };
}

/**
 * Who can use the back office and who is asking to (migration 0008). Owner only: emails are personal data.
 * Waiting requests on top, then the team, then the declined ones folded away. The email identifies a person
 * everywhere here; the name is what their account says, which they can change, so it is only a secondary line.
 * Everything marked data-ph-mask is kept out of session replays, should analytics ever run on this host.
 * `?error=role&user=<uuid>`: an approval went through but the chosen role could not be set (approveAccess); the
 * person is in as an admin. The notice names them by the email from the team list below (the address carries only
 * the id, never the email; an id not in the list gives the notice without one). Every successful team action ends on
 * plain /team, so the notice goes away with the next one.
 */
export default async function TeamPage({ searchParams }: PageProps<"/admin/team">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const params = await searchParams;
  const roleNotSet = params.error === "role";
  const roleNotSetUser = typeof params.user === "string" ? params.user : null;

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
  const roleNotSetEmail = roleNotSetUser
    ? data.team.find((member) => member.user_id === roleNotSetUser)?.email || null
    : null;

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.team.lead}</p>
      {roleNotSet && (
        <Notice tone="negative">
          <span data-ph-mask>{t.team.roleNotSet(roleNotSetEmail)}</span>
        </Notice>
      )}
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
                <Badge tone={isStaffRole(member.role) ? ROLE_TONES[member.role] : "neutral"}>
                  {isStaffRole(member.role) ? t.roles[member.role] : member.role}
                </Badge>
                {member.role !== "owner" && (
                  // Keyed by role: a successful change mounts the controls anew, so an earlier error line goes away.
                  <MemberActions
                    key={`${member.user_id}:${member.role}`}
                    userId={member.user_id}
                    email={member.email || t.team.noEmail}
                    role={isGrantableRole(member.role) ? member.role : null}
                    locale={locale}
                  />
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
