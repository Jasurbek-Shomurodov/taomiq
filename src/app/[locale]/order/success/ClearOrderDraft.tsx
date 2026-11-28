"use client";

import { useEffect } from "react";
import { clearDraft } from "@/lib/order/draft";

/**
 * The order is placed: the plan choices the order form saved on this device (src/lib/order/draft.ts) are removed, so
 * the next visit to the form does not offer to continue an order that is already sent. The form clears them as well
 * when it is left for this page; this covers a reload or a full page load of the success page.
 */
export function ClearOrderDraft() {
  useEffect(() => {
    clearDraft();
  }, []);
  return null;
}
