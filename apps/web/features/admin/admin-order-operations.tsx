"use client";

import type { AdminOrderOperationsDetailDto, AdminOrderSummaryDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { adminApi, apiErrorMessage } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

export function AdminOrderOperations() {
  const [orders, setOrders] = useState<readonly AdminOrderSummaryDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AdminOrderOperationsDetailDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await adminApi.listOrders({ page: 1, pageSize: 100 });
      setOrders(response.items);
      setSelectedId((current) => current && response.items.some((item) => item.id === current) ? current : (response.items[0]?.id ?? ""));
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load the admin order queue."));
      setState("error");
    }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setDetailState("idle");
      return;
    }
    setDetailState("loading");
    setMessage(null);
    try {
      setDetail(await adminApi.getOrderOperations(selectedId));
      setDetailState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not explain this order's operational state."));
      setDetailState("error");
    }
  }, [selectedId]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  return (
    <section className="commerceStack" aria-labelledby="admin-order-ops-heading">
      <div className="sectionHeadingCompact"><div><h2 id="admin-order-ops-heading">Order operations</h2><p>Unified order/payment/refund/shipment/return evidence without direct database access.</p></div><button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void loadOrders()}>Refresh queue</button></div>
      {state === "loading" ? <LoadingState label="Loading admin order queue…" /> : null}
      {state === "error" ? <ErrorState title="Order queue unavailable" message={message ?? "CartNest could not load orders."} action={<button className="secondaryButton" type="button" onClick={() => void loadOrders()}>Try again</button>} /> : null}
      {state === "ready" ? <div className="panel compactPanel"><label className="field">Order<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose an order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {orderStatusLabel(order.status)} · {formatMoney(order.grandTotal)}</option>)}</select></label></div> : null}
      {detailState === "loading" ? <LoadingState label="Building operational case view…" /> : null}
      {detailState === "error" ? <ErrorState title="Order operations unavailable" message={message ?? "CartNest could not load this order case."} action={<button className="secondaryButton" type="button" onClick={() => void loadDetail()}>Retry case</button>} /> : null}
      {detailState === "ready" && detail ? (
        <div className="commerceStack">
          <article className="panel sellerForm"><div className="sectionHeadingCompact"><div><p className="eyebrow">{detail.order.orderNumber}</p><h3>{formatMoney(detail.order.grandTotal)}</h3><p>User {detail.order.userId}</p></div><div className="orderBadgeRow"><span className={orderStatusClass(detail.order.status)}>{orderStatusLabel(detail.order.status)}</span><span className={orderStatusClass(detail.order.paymentStatus)}>Payment {orderStatusLabel(detail.order.paymentStatus)}</span></div></div><div className="orderMetadata"><span>Items {formatMoney(detail.order.itemSubtotal)}</span><span>Discount {formatMoney(detail.order.discount)}</span><span>Delivery {formatMoney(detail.order.delivery)}</span><span>Tax {formatMoney(detail.order.tax)}</span></div></article>
          <div className="formGrid formGridTwo">
            <article className="panel sellerForm"><h3>Vendor orders ({detail.vendorOrders.length})</h3>{detail.vendorOrders.map((item) => <div className="orderItemRow" key={item.id}><div><strong>{item.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(item.status)} · commission {formatMoney(item.commission)} · gateway {formatMoney(item.gatewayFee)}</span></div><strong>{formatMoney(item.total)}</strong></div>)}</article>
            <article className="panel sellerForm"><h3>Payment intents ({detail.paymentIntents.length})</h3>{detail.paymentIntents.map((intent) => <div className="sellerForm" key={intent.id}><div className="orderItemRow"><div><strong>{intent.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(intent.status)}</span></div><strong>{formatMoney(intent.amount)}</strong></div>{intent.attempts.map((attempt) => <p className="fieldHint" key={attempt.id}>{attempt.provider} · {orderStatusLabel(attempt.status)} · {attempt.providerReference ?? "no provider reference"}{attempt.failureCategory ? ` · ${attempt.failureCategory}` : ""}</p>)}</div>)}</article>
            <article className="panel sellerForm"><h3>Refunds ({detail.refunds.length})</h3>{detail.refunds.length === 0 ? <p>None.</p> : detail.refunds.map((refund) => <div className="orderItemRow" key={refund.id}><div><strong>{refund.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(refund.status)} · {refund.reason}</span></div><strong>{formatMoney(refund.amount)}</strong></div>)}</article>
            <article className="panel sellerForm"><h3>Shipments ({detail.shipments.length})</h3>{detail.shipments.length === 0 ? <p>None.</p> : detail.shipments.map((shipment) => <div className="orderItemRow" key={shipment.id}><div><strong>{shipment.trackingNumber ?? shipment.id.slice(0, 8).toUpperCase()}</strong><span>{shipment.provider} · {orderStatusLabel(shipment.status)}</span></div><span>{new Date(shipment.updatedAt).toLocaleString()}</span></div>)}</article>
            <article className="panel sellerForm"><h3>Returns ({detail.returns.length})</h3>{detail.returns.length === 0 ? <p>None.</p> : detail.returns.map((request) => <div className="orderItemRow" key={request.id}><div><strong>{request.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(request.status)} · {request.reason}</span></div><span>{new Date(request.requestedAt).toLocaleDateString()}</span></div>)}</article>
            <article className="panel sellerForm"><h3>Payment allocations ({detail.allocations.length})</h3>{detail.allocations.length === 0 ? <p>None.</p> : detail.allocations.map((allocation, index) => <div className="orderItemRow" key={`${allocation.paymentIntentId}-${allocation.vendorOrderId ?? "platform"}-${allocation.type}-${index}`}><div><strong>{allocation.type}</strong><span>{allocation.vendorOrderId ? `Vendor order ${allocation.vendorOrderId.slice(0, 8).toUpperCase()}` : "Platform allocation"}</span></div><strong>{formatMoney(allocation.amount)}</strong></div>)}</article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
