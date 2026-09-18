"use client";

import type { OrderDto, VendorOrderDto } from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorCode, apiErrorMessage, ordersApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { BuyerShipmentTracking } from "../logistics/shipment-tracking";
import { BuyerPostPurchase } from "../returns/buyer-post-purchase";
import { isUnpaidOpenOrder, orderStatusClass, orderStatusLabel } from "./order-ui";

function variantLabel(item: VendorOrderDto["items"][number]): string {
  if (item.variantAttributes.length === 0) return "Standard variant";
  return item.variantAttributes.map((value) => `${value.optionName}: ${value.value}`).join(" · ");
}

function reservationExpired(order: OrderDto): boolean {
  return Boolean(
    order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() <= Date.now(),
  );
}

function paymentAttemptActive(order: OrderDto): boolean {
  return ["REQUIRES_ACTION", "PROCESSING"].includes(order.paymentIntent.status);
}

function orderProgressIndex(status: string): number {
  if (status === "PENDING_PAYMENT") return -1;
  if (status === "PAID") return 0;
  if (status === "PARTIALLY_FULFILLED") return 2;
  if (status === "FULFILLED") return 3;
  if (status === "PARTIALLY_CANCELLED" || status === "CANCELLED" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED") return 1;
  return -1;
}

export function BuyerOrderDetail({ orderId }: Readonly<{ orderId: string }>) {
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    setState("loading");
    setMessage(null);
    try {
      setOrder(await ordersApi.get(orderId));
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load this order."));
      setState("error");
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  async function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !isUnpaidOpenOrder(order.status, order.paymentStatus) || paymentAttemptActive(order)) return;
    setCancelling(true);
    setMessage(null);
    try {
      const changed = await ordersApi.cancel(order.id, cancelReason.trim() ? { reason: cancelReason.trim() } : {});
      setOrder(changed);
      setCancelReason("");
      setMessage("The unpaid order was cancelled and its remaining held inventory was released.");
    } catch (caught) {
      if (apiErrorCode(caught) === "ORDER_PAYMENT_ACTIVE") {
        setMessage("A payment attempt became active before cancellation completed. Check the payment status first; CartNest did not release the reservation.");
        try { setOrder(await ordersApi.get(order.id)); } catch { /* Keep the cancellation error. */ }
      } else {
        setMessage(apiErrorMessage(caught, "CartNest could not cancel this order."));
      }
    } finally {
      setCancelling(false);
    }
  }

  const reservationLabel = useMemo(() => {
    if (!order?.reservationExpiresAt) return null;
    const expiresAt = new Date(order.reservationExpiresAt);
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0) return `Reservation expired at ${expiresAt.toLocaleString()}`;
    return `Inventory reserved until ${expiresAt.toLocaleString()}`;
  }, [order]);

  if (state === "loading") return <main className="commercePage"><LoadingState label="Loading order…" /></main>;
  if (state === "error" || !order) {
    return <main className="commercePage"><ErrorState title="Order unavailable" message={message ?? "CartNest could not load this order."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;
  }

  const openUnpaid = isUnpaidOpenOrder(order.status, order.paymentStatus);
  const activePayment = paymentAttemptActive(order);
  const expired = reservationExpired(order);
  const cancellable = openUnpaid && !activePayment;
  const canPay = openUnpaid && !activePayment && !expired && ["PENDING", "FAILED"].includes(order.paymentIntent.status);

  return (
    <main className="commercePage orderDetailPage">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Order {order.orderNumber}</p>
          <h1 className="pageTitle">Order details</h1>
          <div className="orderBadgeRow orderDetailBadges">
            <span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span>
            <span className={orderStatusClass(order.paymentStatus)}>Payment: {orderStatusLabel(order.paymentStatus)}</span>
          </div>
        </div>
        <Link className="secondaryButton" href="/orders">← All orders</Link>
      </div>

      {message ? <p className={message.startsWith("The unpaid") ? "formMessage formMessageSuccess" : "formMessage formMessageError"} role="status">{message}</p> : null}

      <section className="panel orderProgressPanel" aria-label="Order progress">
        <div className="sectionHeadingCompact">
          <div><p className="eyebrow">Fulfillment</p><h2>Order progress</h2></div>
          <span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span>
        </div>
        <div className="orderProgressRail">
          {["Payment", "Confirmed", "Preparing", "Delivered"].map((label, index) => (
            <div className={
              index <= orderProgressIndex(order.status)
                ? "orderProgressStep orderProgressStepDone"
                : index === orderProgressIndex(order.status) + 1
                  ? "orderProgressStep orderProgressStepCurrent"
                  : "orderProgressStep"
            } key={label}>
              <b>{index <= orderProgressIndex(order.status) ? "✓" : index + 1}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="orderDetailLayout">
        <div className="commerceStack">
          <section className="panel orderInfoPanel">
            <div className="sectionHeadingCompact"><div><p className="eyebrow">Delivery</p><h2>Address snapshot</h2></div></div>
            <address className="orderAddress">
              <strong>{order.deliveryAddress.recipientName}</strong>
              <span>{order.deliveryAddress.phone}</span>
              <span>{order.deliveryAddress.line1}</span>
              {order.deliveryAddress.line2 ? <span>{order.deliveryAddress.line2}</span> : null}
              <span>{order.deliveryAddress.city}, {order.deliveryAddress.state}{order.deliveryAddress.postalCode ? ` ${order.deliveryAddress.postalCode}` : ""}</span>
              <span>{order.deliveryAddress.countryCode}</span>
            </address>
            {reservationLabel ? <p className="reservationNotice">{reservationLabel}</p> : null}
          </section>

          <section className="orderVendorStack" aria-label="Store orders">
            {order.vendorOrders.map((vendorOrder) => (
              <article className="storeGroup orderVendorCard" key={vendorOrder.id}>
                <div className="storeGroupHeader">
                  <div>
                    <h2>{vendorOrder.store.name}</h2>
                    <span>{vendorOrder.store.vendorDisplayName}</span>
                  </div>
                  <span className={orderStatusClass(vendorOrder.status)}>{orderStatusLabel(vendorOrder.status)}</span>
                </div>

                <div className="orderItemList">
                  {vendorOrder.items.map((item) => (
                    <div className="orderItemRow" key={item.id}>
                      <div>
                        <strong>{item.productName}</strong>
                        <span>{variantLabel(item)}</span>
                        <span>SKU {item.sku} · Qty {item.quantity}</span>
                      </div>
                      <strong>{formatMoney(item.lineTotal)}</strong>
                    </div>
                  ))}
                </div>

                <div className="vendorOrderTotals">
                  <div><span>Items</span><strong>{formatMoney(vendorOrder.itemSubtotal)}</strong></div>
                  {BigInt(vendorOrder.discount.amountMinor) > 0n ? <div><span>Discount</span><strong>−{formatMoney(vendorOrder.discount)}</strong></div> : null}
                  <div><span>Delivery</span><strong>{formatMoney(vendorOrder.delivery)}</strong></div>
                  {BigInt(vendorOrder.tax.amountMinor) > 0n ? <div><span>Tax</span><strong>{formatMoney(vendorOrder.tax)}</strong></div> : null}
                  <div className="vendorOrderTotal"><span>Store total</span><strong>{formatMoney(vendorOrder.total)}</strong></div>
                </div>
              </article>
            ))}
          </section>

          <BuyerShipmentTracking order={order} />
          <BuyerPostPurchase order={order} />
        </div>

        <aside className="commerceSummary orderTotalPanel" aria-label="Order totals">
          <h2>Order total</h2>
          <div className="summaryRows">
            <div className="summaryRow"><span>Items</span><strong>{formatMoney(order.itemSubtotal)}</strong></div>
            {BigInt(order.discount.amountMinor) > 0n ? <div className="summaryRow"><span>Discount</span><strong>−{formatMoney(order.discount)}</strong></div> : null}
            <div className="summaryRow"><span>Delivery</span><strong>{formatMoney(order.delivery)}</strong></div>
            {BigInt(order.tax.amountMinor) > 0n ? <div className="summaryRow"><span>Tax</span><strong>{formatMoney(order.tax)}</strong></div> : null}
            <div className="summaryRow summaryTotal"><span>Total</span><strong>{formatMoney(order.grandTotal)}</strong></div>
          </div>

          <div className="checkoutReadiness">
            <strong>Payment {orderStatusLabel(order.paymentIntent.status)}</strong>
            <p>The payment intent is for {formatMoney(order.paymentIntent.amount)}. A browser redirect is never treated as proof of payment; verified provider state is authoritative.</p>
          </div>

          {canPay ? (
            <Link className="primaryButton" href={`/orders/${encodeURIComponent(order.id)}/payment`}>Pay securely</Link>
          ) : activePayment ? (
            <div className="paymentReconcileBox">
              <strong>Payment attempt in progress</strong>
              <p>Cancellation is blocked while a provider attempt may still complete. Reconcile the payment before taking another action.</p>
              <Link className="secondaryButton" href={`/orders/${encodeURIComponent(order.id)}/payment`}>Check payment status</Link>
            </div>
          ) : expired && openUnpaid ? (
            <p className="formMessage">The inventory reservation expired. A new payment cannot be initialized for this order.</p>
          ) : null}

          {cancellable ? (
            <form className="cancelOrderForm" onSubmit={cancelOrder}>
              <label className="field">Cancellation reason <span className="fieldHint">Optional</span>
                <textarea rows={3} minLength={2} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} disabled={cancelling} placeholder="Reason for cancelling" />
              </label>
              <button className="dangerButton" disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel unpaid order"}</button>
              <p className="fieldHint">Direct cancellation is limited to unpaid orders with no active provider attempt. Remaining held reservations are released atomically.</p>
            </form>
          ) : null}

          <div className="orderMetadata">
            <span>Created {new Date(order.createdAt).toLocaleString()}</span>
            <span>Last updated {new Date(order.updatedAt).toLocaleString()}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
