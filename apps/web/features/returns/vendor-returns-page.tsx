"use client";

import type { ReturnRequestDto, ReturnStatusDto, StoreDto } from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, returnsApi, vendorApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";
import { hasVendorPermission } from "../vendor/permissions";
import { useVendorAccess } from "../vendor/use-vendor-access";
import { VendorWorkspaceShell } from "../vendor/vendor-workspace-shell";

const NEXT_STATUS: Readonly<Record<ReturnStatusDto, readonly ReturnStatusDto[]>> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["AWAITING_RETURN", "REFUND_PENDING"],
  REJECTED: [],
  AWAITING_RETURN: ["IN_TRANSIT", "RECEIVED", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["INSPECTING", "REFUND_PENDING"],
  INSPECTING: ["REFUND_PENDING", "REJECTED"],
  REFUND_PENDING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

const RESTOCKABLE: readonly ReturnStatusDto[] = ["RECEIVED", "INSPECTING", "REFUND_PENDING", "COMPLETED"];

type StoreReturn = { store: StoreDto; request: ReturnRequestDto };

function VendorReturnCard({
  entry,
  canProcess,
  canRestock,
  mutationsDisabled,
  onChanged,
}: Readonly<{
  entry: StoreReturn;
  canProcess: boolean;
  canRestock: boolean;
  mutationsDisabled: boolean;
  onChanged: () => Promise<void>;
}>) {
  const [nextStatus, setNextStatus] = useState<ReturnStatusDto | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const transitions = NEXT_STATUS[entry.request.status];

  async function transition() {
    if (!canProcess || mutationsDisabled || !nextStatus) return;
    setBusy(true);
    setMessage(null);
    try {
      await returnsApi.updateReturnStatus(entry.request.id, {
        status: nextStatus,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNextStatus("");
      setNote("");
      await onChanged();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not update this return request."));
    } finally {
      setBusy(false);
    }
  }

  async function restock() {
    if (!canRestock || mutationsDisabled || !RESTOCKABLE.includes(entry.request.status)) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await returnsApi.restockReturn(entry.request.id);
      setMessage(result.adjustedItems > 0 ? `${result.adjustedItems} returned item line(s) restocked.` : "No additional return items required restocking.");
      await onChanged();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not restock this return."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel sellerForm">
      <div className="sectionHeadingCompact">
        <div><p className="eyebrow">{entry.store.name} · Return {entry.request.id.slice(0, 8).toUpperCase()}</p><h2>{entry.request.reason}</h2><p>Requested {new Date(entry.request.requestedAt).toLocaleString()}</p></div>
        <span className={orderStatusClass(entry.request.status)}>{orderStatusLabel(entry.request.status)}</span>
      </div>

      <div className="orderItemList">
        {entry.request.items.map((item) => (
          <div className="orderItemRow" key={item.id}>
            <div><strong>Order item {item.orderItemId.slice(0, 8).toUpperCase()}</strong><span>{item.condition ? orderStatusLabel(item.condition) : "Condition not specified"}{item.reason ? ` · ${item.reason}` : ""}</span></div>
            <strong>Qty {item.quantity}</strong>
          </div>
        ))}
      </div>

      {canProcess && transitions.length > 0 ? (
        <div className="commerceStack">
          <div className="formGrid formGridTwo">
            <label className="field">Next status<select value={nextStatus} disabled={busy || mutationsDisabled} onChange={(event) => setNextStatus(event.target.value as ReturnStatusDto | "")}><option value="">Choose status</option>{transitions.map((status) => <option key={status} value={status}>{orderStatusLabel(status)}</option>)}</select></label>
            <label className="field">Internal workflow note <span className="fieldHint">Optional</span><input minLength={2} maxLength={1000} value={note} disabled={busy || mutationsDisabled} onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          <div className="actionRow"><button className="secondaryButton" type="button" disabled={busy || mutationsDisabled || !nextStatus} onClick={() => void transition()}>{busy ? "Updating…" : "Update return status"}</button></div>
        </div>
      ) : null}

      {canRestock && RESTOCKABLE.includes(entry.request.status) ? (
        <div className="commerceStack">
          <div className="actionRow"><button className="secondaryButton" type="button" disabled={busy || mutationsDisabled} onClick={() => void restock()}>{busy ? "Working…" : "Restock returned merchandise"}</button></div>
          <p className="fieldHint">Restocking is an explicit inventory action. Inspect mixed-condition returns before using this control; the backend prevents duplicate restocks per ReturnItem.</p>
        </div>
      ) : null}

      {entry.request.refunds.length > 0 ? <p className="fieldHint">Linked refunds: {entry.request.refunds.map((refund) => `${orderStatusLabel(refund.status)} ${refund.amount.amountMinor} ${refund.amount.currency} minor units`).join(" · ")}</p> : null}
      {message ? <p className="formMessage" role="status">{message}</p> : null}
    </article>
  );
}

export function VendorReturnsPage({ vendorId }: Readonly<{ vendorId: string }>) {
  const { access, state: accessState, error: accessError, reload: reloadAccess } = useVendorAccess(vendorId);
  const [entries, setEntries] = useState<readonly StoreReturn[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const canRead = access ? hasVendorPermission(access, "order:read") : false;
  const canProcess = access ? hasVendorPermission(access, "order:process") : false;
  const canRestock = access ? hasVendorPermission(access, "inventory:adjust") : false;

  const load = useCallback(async () => {
    if (!access || !canRead) return;
    setState("loading");
    setMessage(null);
    try {
      const stores = await vendorApi.listStores(vendorId);
      const groups = await Promise.all(stores.items.map(async (store) => ({
        store,
        response: await returnsApi.listStoreReturns(store.id, { pageSize: 100 }),
      })));
      setEntries(groups.flatMap(({ store, response }) => response.items.map((request) => ({ store, request }))));
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load this vendor's returns."));
      setState("error");
    }
  }, [access, canRead, vendorId]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => [...entries].sort((a, b) => new Date(b.request.requestedAt).getTime() - new Date(a.request.requestedAt).getTime()), [entries]);

  if (accessState === "loading") return <LoadingState label="Loading vendor returns…" />;
  if (accessState === "error" || !access) return <ErrorState title="Vendor workspace unavailable" message={accessError ?? "CartNest could not load this vendor."} action={<button className="secondaryButton" type="button" onClick={() => void reloadAccess()}>Try again</button>} />;
  if (!canRead) return <ErrorState title="Returns access restricted" message="Your vendor membership does not include order:read." />;

  return (
    <main className="pageShell">
      <VendorWorkspaceShell access={access}>
        <div className="workspacePageHeader"><div><p className="eyebrow">FP9 operations</p><h1 className="pageTitle">Returns</h1><p className="muted">Process delivered-order returns and make explicit restocking decisions across your stores.</p></div><button className="secondaryButton" type="button" onClick={() => void load()} disabled={state === "loading"}>{state === "loading" ? "Refreshing…" : "Refresh"}</button></div>
        {state === "loading" ? <LoadingState label="Loading return queue…" /> : null}
        {state === "error" ? <ErrorState title="Return queue unavailable" message={message ?? "CartNest could not load returns."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}
        {state === "ready" && sorted.length === 0 ? <div className="panel"><h2>No return requests</h2><p className="muted">Delivered buyer returns will appear here.</p></div> : null}
        {state === "ready" ? <section className="commerceStack">{sorted.map((entry) => <VendorReturnCard key={entry.request.id} entry={entry} canProcess={canProcess} canRestock={canRestock} mutationsDisabled={state !== "ready"} onChanged={load} />)}</section> : null}
      </VendorWorkspaceShell>
    </main>
  );
}
