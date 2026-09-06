"use client";

import type {
  AdminOrderSummaryDto,
  AdminPaymentSummaryDto,
  AdminRefundSummaryDto,
  AdminUserSummaryDto,
  PlatformAnalyticsDto,
} from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { adminApi, apiErrorMessage } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { orderStatusLabel } from "../orders/order-ui";
import { localDateToIso } from "./admin-utils";

function Metric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return <div className="panel compactPanel"><span className="commerceMeta">{label}</span><strong className="productPrice">{value}</strong></div>;
}

export function AdminOverview() {
  const [analytics, setAnalytics] = useState<PlatformAnalyticsDto | null>(null);
  const [users, setUsers] = useState<readonly AdminUserSummaryDto[]>([]);
  const [orders, setOrders] = useState<readonly AdminOrderSummaryDto[]>([]);
  const [payments, setPayments] = useState<readonly AdminPaymentSummaryDto[]>([]);
  const [refunds, setRefunds] = useState<readonly AdminRefundSummaryDto[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const fromIso = localDateToIso(from);
    const toIso = localDateToIso(to, true);
    if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) {
      setMessage("Analytics start date cannot be after the end date.");
      setState("error");
      return;
    }
    setState("loading");
    setMessage(null);
    try {
      const [analyticsResponse, userResponse, orderResponse, paymentResponse, refundResponse] = await Promise.all([
        adminApi.getPlatformAnalytics({ ...(fromIso ? { from: fromIso } : {}), ...(toIso ? { to: toIso } : {}) }),
        adminApi.listUsers({ page: 1, pageSize: 10 }),
        adminApi.listOrders({ page: 1, pageSize: 10 }),
        adminApi.listPayments({ page: 1, pageSize: 10 }),
        adminApi.listRefunds({ page: 1, pageSize: 10 }),
      ]);
      setAnalytics(analyticsResponse);
      setUsers(userResponse.items);
      setOrders(orderResponse.items);
      setPayments(paymentResponse.items);
      setRefunds(refundResponse.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load the admin overview."));
      setState("error");
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="commerceStack" aria-labelledby="admin-overview-heading">
      <div className="sectionHeadingCompact"><div><h2 id="admin-overview-heading">Platform overview</h2><p>Operational counts and commercial values come from server-side marketplace state.</p></div><button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>{state === "loading" ? "Refreshing…" : "Refresh"}</button></div>
      <div className="panel compactPanel sellerForm">
        <div className="formGrid formGridTwo">
          <label className="field">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
      </div>
      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {state === "loading" ? <LoadingState label="Loading platform operations…" /> : null}
      {state === "error" ? <ErrorState title="Admin overview unavailable" message={message ?? "CartNest could not load platform state."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}
      {state === "ready" && analytics ? (
        <>
          <div className="analyticsGrid">
            <Metric label="Users" value={analytics.users} />
            <Metric label="Approved vendors" value={analytics.approvedVendors} />
            <Metric label="Active stores" value={analytics.activeStores} />
            <Metric label="Active products" value={analytics.activeProducts} />
            <Metric label="Orders" value={analytics.orders} />
            <Metric label="Paid orders" value={analytics.paidOrders} />
            <Metric label="GMV" value={formatMoney(analytics.grossMerchandiseValue)} />
            <Metric label="Refunded" value={formatMoney(analytics.refundedValue)} />
            <Metric label="Pending returns" value={analytics.pendingReturns} />
            <Metric label="Failed notifications" value={analytics.failedNotifications} />
          </div>
          <div className="formGrid formGridTwo">
            <article className="panel sellerForm"><h3>Recent users</h3>{users.map((user) => <div className="orderItemRow" key={user.id}><div><strong>{user.email ?? user.phone ?? user.id.slice(0, 8)}</strong><span>{user.platformRole} · {user.status}</span></div><span>{new Date(user.createdAt).toLocaleDateString()}</span></div>)}</article>
            <article className="panel sellerForm"><h3>Recent orders</h3>{orders.map((order) => <div className="orderItemRow" key={order.id}><div><strong>{order.orderNumber}</strong><span>{orderStatusLabel(order.status)} · payment {orderStatusLabel(order.paymentStatus)}</span></div><strong>{formatMoney(order.grandTotal)}</strong></div>)}</article>
            <article className="panel sellerForm"><h3>Recent payments</h3>{payments.map((payment) => <div className="orderItemRow" key={payment.id}><div><strong>{payment.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(payment.status)}</span></div><strong>{formatMoney(payment.amount)}</strong></div>)}</article>
            <article className="panel sellerForm"><h3>Recent refunds</h3>{refunds.map((refund) => <div className="orderItemRow" key={refund.id}><div><strong>{refund.id.slice(0, 8).toUpperCase()}</strong><span>{orderStatusLabel(refund.status)} · {refund.provider}</span></div><strong>{formatMoney(refund.amount)}</strong></div>)}</article>
          </div>
        </>
      ) : null}
    </section>
  );
}
