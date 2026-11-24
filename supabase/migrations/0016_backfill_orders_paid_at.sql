-- Plan: docs/plans/finance-investor-payroll.md, risk 3 (the one-off backfill, approved by the owner).
--
-- DESTRUCTIVE (changes existing rows), approved:
--   1. UPDATE public.orders: paid_at = created_at for orders that were already paid before 0013 added the
--      column (status paid, active or completed, paid_at still null). Nothing else is written.
--
-- Why created_at: no status history exists, so the real payment moment of those orders is unknown. The finance
-- functions already date them by coalesce(paid_at, created_at), so no report figure moves; this only fills the
-- column so every paid order carries a date.
--
-- The updated_at trigger is switched off for this one statement so the backfill does not make every old order
-- look edited today. It is switched back on in the same transaction; if anything fails, all of it rolls back.
-- Cancelled, new and confirmed orders are left null: they were not paid, or it is not known that they were.

alter table public.orders disable trigger orders_set_updated_at;

update public.orders
set paid_at = created_at
where paid_at is null
  and status in ('paid', 'active', 'completed');

alter table public.orders enable trigger orders_set_updated_at;
