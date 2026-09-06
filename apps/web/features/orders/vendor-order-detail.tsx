"use client";

import type { VendorOrderDto } from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorCode, apiErrorMessage, ordersApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { VendorShipmentManager } from "../logistics/shipment-tracking";
import { VendorRefunds } from "../returns/vendor-refunds";
import { hasVendorPermission } from "../vendor/permissions";
import { useVendorAccess } from "../vendor/use-vendor-access";
import { VendorWorkspaceShell } from "../vendor/vendor-workspace-shell";
import { canCancelVendorOrder, orderStatusClass, orderStatusLabel } from "./order-ui";

function variantLabel(item: VendorOrderDto["items"][number]): string {
  if (item.variantAttributes.length === 0) return "Standard variant";
  return item.variantAttributes.map((value) => `${value.optionName}: ${value.value}`).join(" · ");
}

export function VendorOrderDetail({
  vendorId,
  vendorOrderId,
}: Readonly<{
  vendorId: string;
  vendorOrderId: string;
}>) {
  const { access, state: accessState, error: accessError, reload: reloadAccess } = useVendorAccess(vendorId);
  const [order, setOrder] = useState<VendorOrderDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canRead = access ? hasVendorPermission(access, "order:read") : false;
  const canProcess = access ? hasVendorPermission(access, "order:process") : false;
  const canFulfill = access ? hasVendorPermission(access, "order:fulfill") : false;
  const canRequestRefund = access ? hasVendorPermission(access, "refund:request") : false;

  const load = useCallback(async () => {
    if (!access || !canRead || !vendorOrderId) return;
    setState("loading");
    setMessage(null);
    try {
      const next = await ordersApi.getVendorOrder(vendorOrderId);
      if (next.vendorId !== access.vendor.id) {
        setOrder(null);
        setMessage("This vendor order does not belong to the vendor workspace in the URL.");
        setState("error");
        return;
      }
      setOrder(next);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load this vendor order."));
      setState("error");
    }
  }, [access, canRead, vendorOrderId]);

  useEffect(() => { void load(); }, [load]);

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !canProcess || !canCancelVendorOrder(order)) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await ordersApi.cancelVendorOrder(order.id, reason.trim() ? { reason: reason.trim() } : {});
      setOrder(next);
      setReason("");
      setMessage("This unpaid store order was cancelled. Its held inventory was released and the parent order totals were recalculated.");
    } catch (caught) {
      if (apiErrorCode(caught) === "ORDER_PAYMENT_ACTIVE") {
        setMessage("A buyer payment attempt is active for the parent order. CartNest did not release this store's inventory. Wait for payment reconciliation before cancelling.");
        try { setOrder(await ordersApi.getVendorOrder(order.id)); } catch { /* Keep the cancellation error. */ }
      } else {
        setMessage(apiErrorMessage(caught, "CartNest could not cancel this vendor order."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (accessState === "loading") return <LoadingState label="Loading vendor order…" />;
  if (accessState === "error" || !access) return <ErrorState title="Vendor workspace unavailable" message={accessError ?? "CartNest could not load this vendor."} action={<button className="secondaryButton" type="button" onClick={() => void reloadAccess()}>Try again</button>} />;
  if (!canRead) return <ErrorState title="Order access restricted" message="Your vendor membership does not include order:read or an order capability that implies read access." />;

  return (
    <main className="pageShell">
      <VendorWorkspaceShell access={access}>
        {state === "loading" ? <LoadingState label="Loading vendor order…" /> : null}
        {state === "error" || !order ? <ErrorState title="Vendor order unavailable" message={message ?? "CartNest could not load this vendor order."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}

        {state === "ready" && order ? (
          <div className="vendorOrderDetailPage commerceStack">
            <div className="workspacePageHeader">
              <div>
                <p className="eyebrow">{order.store.name} · {order.id.slice(0, 8).toUpperCase()}</p>
                <h1 className="pageTitle">Vendor order</h1>
                <div className="orderBadgeRow orderDetailBadges">
                  <span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span>
                  <span className={orderStatusClass(order.paymentStatus)}>Payment: {orderStatusLabel(order.paymentStatus)}</span>
                  <span className={orderStatusClass(order.orderStatus)}>Parent: {orderStatusLabel(order.orderStatus)}</span>
                </div>
              </div>
              <Link className="secondaryButton" href={`/vendor/${encodeURIComponent(vendorId)}/orders`}>← Order queue</Link>
            </div>

            {message ? <p className={message.startsWith("This unpaid") ? "formMessage formMessageSuccess" : "formMessage formMessageError"} role="status">{message}</p> : null}

            <div className="vendorOrderDetailLayout">
              <section className="panel">
                <div className="sectionHeadingCompact"><div><p className="eyebrow">Items</p><h2>{order.items.reduce((sum, item) => sum + item.quantity, 0)} unit(s)</h2></div></div>
                <div className="orderItemList">
                  {order.items.map((item) => (
                    <div className="orderItemRow" key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>{variantLabel(item)}</span>
                        <span>SKU {item.sku} · Qty {item.quantity} · {formatMoney(item.unitPrice)} each</span>
                      </div>
                      <strong>{formatMoney(item.lineTotal)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="commerceSummary vendorOrderFinancials">
                <h2>Store totals</h2>
                <div className="summaryRows">
                  <div className="summaryRow"><span>Items</span><strong>{formatMoney(order.itemSubtotal)}</strong></div>
                  {BigInt(order.discount.amountMinor) > 0n ? <div className="summaryRow"><span>Discount</span><strong>−{formatMoney(order.discount)}</strong></div> : null}
                  <div className="summaryRow"><span>Delivery</span><strong>{formatMoney(order.delivery)}</strong></div>
                  {BigInt(order.tax.amountMinor) > 0n ? <div className="summaryRow"><span>Tax</span><strong>{formatMoney(order.tax)}</strong></div> : null}
                  <div className="summaryRow summaryTotal"><span>Total</span><strong>{formatMoney(order.total)}</strong></div>
                </div>
                <div className="vendorFinancialMeta">
                  <span>Commission snapshot: {(order.commissionRateBps / 100).toFixed(2)}%</span>
                  <span>Commission amount: {formatMoney(order.commission)}</span>
                  <span>Gateway fee snapshot: {formatMoney(order.gatewayFee)}</span>
                </div>

                {canProcess && canCancelVendorOrder(order) ? (
                  <form className="cancelOrderForm" onSubmit={cancel}>
                    <label className="field">Cancellation reason <span className="fieldHint">Optional</span>
                      <textarea rows={3} minLength={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
                    </label>
                    <button className="dangerButton" disabled={busy}>{busy ? "Cancelling…" : "Cancel unpaid store order"}</button>
                    <p className="fieldHint">The backend rejects cancellation if a provider attempt becomes active, even when the visible parent payment state has not refreshed yet.</p>
                  </form>
                ) : null}

                {!canProcess ? <p className="fieldHint">Your membership can view orders but does not include order:process, so cancellation controls are hidden.</p> : null}
              </aside>
            </div>

            <VendorShipmentManager order={order} canFulfill={canFulfill} onOrderChanged={load} />
            <VendorRefunds order={order} canRequest={canRequestRefund} />
          </div>
        ) : null}
      </VendorWorkspaceShell>
    </main>
  );
}
