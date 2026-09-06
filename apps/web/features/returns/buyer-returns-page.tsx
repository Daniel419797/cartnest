"use client";

import type { ReturnRequestDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, returnsApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

function ReturnCard({ request, onChanged }: Readonly<{ request: ReturnRequestDto; onChanged: () => Promise<void> }>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    if (request.status !== "REQUESTED") return;
    setBusy(true);
    setMessage(null);
    try {
      await returnsApi.cancelMyReturn(request.id);
      await onChanged();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not cancel this return request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel sellerForm">
      <div className="sectionHeadingCompact">
        <div><p className="eyebrow">Return {request.id.slice(0, 8).toUpperCase()}</p><h2>{request.reason}</h2><p>Requested {new Date(request.requestedAt).toLocaleString()}</p></div>
        <span className={orderStatusClass(request.status)}>{orderStatusLabel(request.status)}</span>
      </div>

      <div className="orderItemList">
        {request.items.map((item) => (
          <div className="orderItemRow" key={item.id}>
            <div><strong>Order item {item.orderItemId.slice(0, 8).toUpperCase()}</strong><span>{item.condition ? orderStatusLabel(item.condition) : "Condition not specified"}{item.reason ? ` · ${item.reason}` : ""}</span></div>
            <strong>Qty {item.quantity}</strong>
          </div>
        ))}
      </div>

      {request.refunds.length > 0 ? (
        <div className="commerceStack">
          <h3>Refunds</h3>
          {request.refunds.map((refund) => (
            <div className="orderItemRow" key={refund.id}>
              <div><strong>{formatMoney(refund.amount)}</strong><span>{refund.reason} · {refund.provider}</span></div>
              <span className={orderStatusClass(refund.status)}>{orderStatusLabel(refund.status)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="orderMetadata">
        {request.approvedAt ? <span>Approved {new Date(request.approvedAt).toLocaleString()}</span> : null}
        {request.receivedAt ? <span>Received {new Date(request.receivedAt).toLocaleString()}</span> : null}
        {request.completedAt ? <span>Completed {new Date(request.completedAt).toLocaleString()}</span> : null}
        <span>Updated {new Date(request.updatedAt).toLocaleString()}</span>
      </div>

      {request.status === "REQUESTED" ? <div className="actionRow"><button className="dangerButton" type="button" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelling…" : "Cancel request"}</button></div> : null}
      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
    </article>
  );
}

export function BuyerReturnsPage() {
  const [returns, setReturns] = useState<readonly ReturnRequestDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await returnsApi.listMyReturns({ pageSize: 100 });
      setReturns(response.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load your return requests."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <main className="commercePage"><LoadingState label="Loading returns…" /></main>;
  if (state === "error") return <main className="commercePage"><ErrorState title="Returns unavailable" message={message ?? "CartNest could not load returns."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;

  return (
    <main className="commercePage commerceStack">
      <div className="commerceHeader"><div className="commerceHeaderCopy"><p className="eyebrow">FP9 returns</p><h1 className="pageTitle">Your returns</h1><p>Track return decisions, received merchandise, and linked refunds.</p></div><button className="secondaryButton" type="button" onClick={() => void load()}>Refresh</button></div>
      {returns.length === 0 ? <div className="panel"><h2>No return requests</h2><p className="muted">Delivered purchases become eligible from their order-detail page.</p></div> : returns.map((request) => <ReturnCard key={request.id} request={request} onChanged={load} />)}
    </main>
  );
}
