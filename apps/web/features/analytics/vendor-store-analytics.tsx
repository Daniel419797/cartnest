"use client";

import type { StoreAnalyticsDto, StoreDto } from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import { adminApi, apiErrorMessage, vendorApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { hasVendorPermission } from "../vendor/permissions";
import { useVendorAccess } from "../vendor/use-vendor-access";
import { VendorWorkspaceShell } from "../vendor/vendor-workspace-shell";

function toIsoBoundary(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function Metric({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return <div className="panel compactPanel"><span className="commerceMeta">{label}</span><strong className="productPrice">{value}</strong></div>;
}

export function VendorStoreAnalytics({ vendorId }: Readonly<{ vendorId: string }>) {
  const { access, state: accessState, error: accessError, reload: reloadAccess } = useVendorAccess(vendorId);
  const [stores, setStores] = useState<readonly StoreDto[]>([]);
  const [storeId, setStoreId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [analytics, setAnalytics] = useState<StoreAnalyticsDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const canRead = access ? hasVendorPermission(access, "analytics:read") : false;

  const loadStores = useCallback(async () => {
    if (!access || !canRead) return;
    setState("loading");
    setMessage(null);
    try {
      const response = await vendorApi.listStores(vendorId);
      setStores(response.items);
      setStoreId((current) => current && response.items.some((store) => store.id === current) ? current : (response.items[0]?.id ?? ""));
      if (response.items.length === 0) {
        setAnalytics(null);
        setState("ready");
      }
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load stores for analytics."));
      setState("error");
    }
  }, [access, canRead, vendorId]);

  const loadAnalytics = useCallback(async () => {
    if (!storeId || !canRead) return;
    const fromIso = toIsoBoundary(from, false);
    const toIso = toIsoBoundary(to, true);
    if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) {
      setMessage("Analytics start date cannot be after the end date.");
      setState("error");
      return;
    }
    setState("loading");
    setMessage(null);
    try {
      setAnalytics(await adminApi.getStoreAnalytics(storeId, {
        ...(fromIso ? { from: fromIso } : {}),
        ...(toIso ? { to: toIso } : {}),
      }));
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load store analytics."));
      setState("error");
    }
  }, [canRead, from, storeId, to]);

  useEffect(() => { void loadStores(); }, [loadStores]);
  useEffect(() => { if (storeId) void loadAnalytics(); }, [loadAnalytics, storeId]);

  const selectedStore = useMemo(() => stores.find((store) => store.id === storeId) ?? null, [storeId, stores]);

  if (accessState === "loading") return <LoadingState label="Loading analytics access…" />;
  if (accessState === "error" || !access) return <ErrorState title="Vendor workspace unavailable" message={accessError ?? "CartNest could not load this vendor."} action={<button className="secondaryButton" type="button" onClick={() => void reloadAccess()}>Try again</button>} />;
  if (!canRead) return <ErrorState title="Analytics access restricted" message="Your vendor membership does not include analytics:read." />;

  return (
    <main className="pageShell">
      <VendorWorkspaceShell access={access}>
        <div className="workspacePageHeader">
          <div><p className="eyebrow">FP10 analytics</p><h1 className="pageTitle">Store analytics</h1><p className="muted">Commercial metrics are read from server-side VendorOrder, refund, commission, tax, delivery, and fee snapshots.</p></div>
          <button className="secondaryButton" type="button" disabled={state === "loading" || !storeId} onClick={() => void loadAnalytics()}>{state === "loading" ? "Refreshing…" : "Refresh"}</button>
        </div>

        {stores.length > 0 ? (
          <section className="panel compactPanel sellerForm">
            <div className="formGrid formGridTwo">
              <label className="field">Store<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
              <label className="field">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <label className="field">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            <div className="actionRow"><button className="secondaryButton" type="button" onClick={() => void loadAnalytics()} disabled={state === "loading"}>Apply range</button><button className="ghostButton" type="button" disabled={!from && !to} onClick={() => { setFrom(""); setTo(""); }}>Clear range</button></div>
          </section>
        ) : null}

        {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
        {state === "loading" ? <LoadingState label="Loading store analytics…" /> : null}
        {state === "error" ? <ErrorState title="Analytics unavailable" message={message ?? "CartNest could not load analytics."} action={<button className="secondaryButton" type="button" onClick={() => void loadAnalytics()}>Try again</button>} /> : null}
        {state === "ready" && stores.length === 0 ? <EmptyState title="No stores available" message="Create a store before analytics can be calculated." /> : null}

        {state === "ready" && selectedStore && analytics ? (
          <section className="commerceStack" aria-labelledby="store-analytics-heading">
            <div className="sectionHeadingCompact"><div><h2 id="store-analytics-heading">{selectedStore.name}</h2><p>Current server-calculated financial view for the selected range.</p></div><span className="statusPill">{analytics.orders} order(s)</span></div>
            <div className="analyticsGrid">
              <Metric label="Orders" value={analytics.orders} />
              <Metric label="Delivered" value={analytics.deliveredOrders} />
              <Metric label="Gross sales" value={formatMoney(analytics.grossSales)} />
              <Metric label="Refunded" value={formatMoney(analytics.refundedValue)} />
              <Metric label="Discounts" value={formatMoney(analytics.discounts)} />
              <Metric label="Tax" value={formatMoney(analytics.tax)} />
              <Metric label="Delivery" value={formatMoney(analytics.delivery)} />
              <Metric label="Commission" value={formatMoney(analytics.commission)} />
              <Metric label="Gateway fees" value={formatMoney(analytics.gatewayFees)} />
            </div>
          </section>
        ) : null}
      </VendorWorkspaceShell>
    </main>
  );
}
