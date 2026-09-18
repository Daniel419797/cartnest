"use client";

import type { OrderListResponseDto, OrderStatusDto } from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, ordersApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { ORDER_STATUSES, orderStatusClass, orderStatusLabel } from "./order-ui";

export function BuyerOrdersPageContent() {
  const [result, setResult] = useState<OrderListResponseDto | null>(null);
  const [status, setStatus] = useState<"" | OrderStatusDto>("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const next = await ordersApi.list({ page, pageSize: 20, ...(status ? { status } : {}) });
      setResult(next);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load your orders."));
      setState("error");
    }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  function changeStatus(next: "" | OrderStatusDto) {
    setStatus(next);
    setPage(1);
  }

function orderProgressIndex(status: OrderStatusDto): number {
  if (status === "PENDING_PAYMENT") return -1;
  if (status === "PAID") return 0;
  if (status === "PARTIALLY_FULFILLED") return 2;
  if (status === "FULFILLED") return 3;
  if (status === "PARTIALLY_CANCELLED" || status === "CANCELLED" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED") return 1;
  return -1;
}

  return (
    <main className="commercePage ordersPage">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Purchases</p>
          <h1 className="pageTitle">Your orders</h1>
          <p className="muted">Track the parent order, payment state and each store-specific fulfillment slice from one place.</p>
        </div>
        <Link className="secondaryButton" href="/marketplace">Continue shopping</Link>
      </div>

      <div className="ordersToolbar panel compactPanel">
        <label className="field">Order status
          <select value={status} onChange={(event) => changeStatus(event.target.value as "" | OrderStatusDto)}>
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((item) => <option key={item} value={item}>{orderStatusLabel(item)}</option>)}
          </select>
        </label>
      </div>

      {state === "loading" ? <LoadingState label="Loading orders…" /> : null}
      {state === "error" ? <ErrorState title="Orders unavailable" message={message ?? "CartNest could not load your orders."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}

      {state === "ready" && result ? (
        result.items.length === 0 ? (
          <EmptyState title={status ? "No orders match this status" : "No orders yet"} message={status ? "Change the order-status filter to see other purchases." : "Your completed checkouts will appear here."} action={!status ? <Link className="primaryButton" href="/marketplace">Browse marketplace</Link> : undefined} />
        ) : (
          <>
            <section className="orderCardList" aria-label="Orders">
              {result.items.map((order) => (
                <Link className="orderSummaryCard" href={`/orders/${encodeURIComponent(order.id)}`} key={order.id}>
                  <div className="orderSummaryTop">
                    <div>
                      <span className="commerceMeta">Order</span>
                      <strong>{order.orderNumber}</strong>
                    </div>
                    <div className="orderBadgeRow">
                      <span className={orderStatusClass(order.status)}>{orderStatusLabel(order.status)}</span>
                      <span className={orderStatusClass(order.paymentStatus)}>Payment: {orderStatusLabel(order.paymentStatus)}</span>
                    </div>
                  </div>
                  <div className="orderProgressMini" aria-label={`Order progress: ${orderStatusLabel(order.status)}`}>
                    {["Payment", "Confirmed", "Preparing", "Delivered"].map((label, index) => (
                      <span className={
                        index <= orderProgressIndex(order.status)
                          ? "orderProgressStep orderProgressStepDone"
                          : index === orderProgressIndex(order.status) + 1
                            ? "orderProgressStep orderProgressStepCurrent"
                            : "orderProgressStep"
                      } key={label}>
                        <b>{index <= orderProgressIndex(order.status) ? "✓" : index + 1}</b>{label}
                      </span>
                    ))}
                  </div>
                  <div className="orderSummaryBottom">
                    <div><span className="commerceMeta">Placed</span><strong>{new Date(order.createdAt).toLocaleString()}</strong></div>
                    <div><span className="commerceMeta">Store orders</span><strong>{order.vendorOrderCount}</strong></div>
                    <div><span className="commerceMeta">Total</span><strong>{formatMoney(order.grandTotal)}</strong></div>
                    <span className="orderOpenLabel">View order →</span>
                  </div>
                </Link>
              ))}
            </section>

            <div className="paginationRow" aria-label="Order pagination">
              <button className="secondaryButton compactButton" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <span className="commerceMeta">Page {result.pagination.page} of {Math.max(1, result.pagination.totalPages)} · {result.pagination.totalItems} order(s)</span>
              <button className="secondaryButton compactButton" type="button" disabled={result.pagination.totalPages === 0 || page >= result.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </>
        )
      ) : null}
    </main>
  );
}
