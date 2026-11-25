import { PackageX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { getCustomer } from "@/lib/admin/customer-queries";
import { customerHref, parseCustomerKey } from "@/lib/admin/customers";
import { formatPhone } from "@/lib/admin/orders";
import { listDurations, listPrograms } from "@/lib/admin/queries";
import { loadBusinessSettings } from "@/lib/admin/settings-queries";
import { tashkentDay } from "@/lib/admin/stats";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { NewOrderForm, type FormDuration, type FormProgram, type NewOrderInitial } from "../OrderForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).orderForm.newTitle };
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A new order taken by phone or Telegram (docs/plans/zarkebab-feature-port.md, slice 2). Owners and managers. Only
 * active programs, levels and durations are offered (the database refuses others too); the delivery windows are the
 * ones the site offers now.
 *
 * `?customer=<key>` (the customer page's "New order for this customer", slice 4) fills in the customer's name, phone,
 * last address and last window (when the site still offers it). The key is an order id, resolved by
 * public.customer_detail, so no phone number is ever in the address. A key that does not resolve leaves the form
 * empty with a notice.
 */
export default async function NewOrderPage({ searchParams }: PageProps<"/admin/orders/new">) {
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const customerKey = parseCustomerKey(one((await searchParams).customer));
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;

  // The customer is read beside the catalogue; a failed read only leaves the contact fields empty.
  const customerRead = customerKey
    ? getCustomer(supabase, customerKey).catch((error: unknown) => {
        console.error("new order: customer read failed", error instanceof Error ? error.message : error);
        return null;
      })
    : Promise.resolve(null);

  let data: { programs: FormProgram[]; durations: FormDuration[]; windows: string[] } | null = null;
  try {
    const [programs, durations, settings] = await Promise.all([
      listPrograms(supabase),
      listDurations(supabase),
      loadBusinessSettings(supabase),
    ]);
    data = {
      programs: programs
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          name: p.name,
          variants: p.variants
            .filter((v) => v.active)
            .map((v) => ({ id: v.id, kcal: v.kcal, price: v.price_per_day })),
        }))
        .filter((p) => p.variants.length > 0),
      durations: durations.map((d) => ({ days: d.days, markup: Number(d.markup_pct) })),
      windows: settings.deliveryWindows,
    };
  } catch (error) {
    console.error("new order: catalogue read failed", error instanceof Error ? error.message : error);
  }
  const customer = await customerRead;
  const initial: NewOrderInitial | undefined =
    customer && data
      ? {
          name: customer.customer_name,
          phone: formatPhone(customer.phone),
          address: customer.last_address,
          window: data.windows.includes(customer.last_window) ? customer.last_window : undefined,
        }
      : undefined;
  const backHref = customer ? customerHref(customer.customer_key) : "/orders";
  const backLabel = customer ? t.customers.back : t.order.back;

  return (
    <div className="adm-page">
      <TopBarBack href={backHref} label={backLabel} />
      <TopBarTitle>
        <span className="adm-truncate">{t.orderForm.newTitle}</span>
      </TopBarTitle>
      {!data ? (
        <Notice
          tone="negative"
          retry={{ href: customerKey ? `/orders/new?customer=${customerKey}` : "/orders/new", label: t.common.retry }}
        >
          {t.orderForm.loadFailed}
        </Notice>
      ) : data.programs.length === 0 || data.durations.length === 0 ? (
        <Panel>
          <EmptyState
            icon={PackageX}
            action={
              staff.role === "owner" ? (
                <Link href="/programs" className="adm-btn adm-btn-outline">
                  {t.nav.programs}
                </Link>
              ) : undefined
            }
          >
            {t.orderForm.noPrograms}
          </EmptyState>
        </Panel>
      ) : (
        <>
          {customerKey &&
            (initial ? (
              <Notice tone="info">
                {t.customers.prefilled(initial.name, initial.phone)}
              </Notice>
            ) : (
              <Notice tone="caution">{t.customers.prefillFailed}</Notice>
            ))}
          <NewOrderForm
            key={customer?.customer_key ?? "blank"}
            initial={initial}
            programs={data.programs}
            durations={data.durations}
            windows={data.windows}
            today={today}
            locale={locale}
          />
        </>
      )}
    </div>
  );
}
