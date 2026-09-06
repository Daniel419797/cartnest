"use client";

import type { CreateRefundBodyDto, RefundDto, ReturnRequestDto, VendorOrderDto } from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiErrorMessage, returnsApi } from "../../lib/api";
import { formatMoney, parseNairaToMinor } from "../catalog/catalog-utils";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const RESERVED_REFUND_STATUSES = new Set<RefundDto["status"]>([
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "SUCCEEDED",
]);

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `fp9-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestFingerprint(body: CreateRefundBodyDto): string {
  return JSON.stringify({
    amountMinor: body.amountMinor,
    reason: body.reason,
    orderItemId: body.orderItemId ?? null,
    returnRequestId: body.returnRequestId ?? null,
  });
}

export function VendorRefunds({
  order,
  canRequest,
}: Readonly<{
  order: VendorOrderDto;
  canRequest: boolean;
}>) {
  const [refunds, setRefunds] = useState<readonly RefundDto[]>([]);
  const [returns, setReturns] = useState<readonly ReturnRequestDto[]>([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [orderItemId, setOrderItemId] = useState("");
  const [returnRequestId, setReturnRequestId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    setState("loading");
    setMessage(null);
    setSuccess(false);
    try {
      const [refundResponse, returnResponse] = await Promise.all([
        returnsApi.listVendorOrderRefunds(order.id, { pageSize: 100 }),
        returnsApi.listStoreReturns(order.store.id, { vendorOrderId: order.id, pageSize: 100 }),
      ]);
      setRefunds(refundResponse.items);
      setReturns(returnResponse.items);
      setState("ready");
      return true;
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load refund history for this vendor order."));
      setState("error");
      return false;
    }
  }, [order.id, order.store.id]);

  useEffect(() => { void load(); }, [load]);

  const reservedMinor = useMemo(
    () => refunds.filter((refund) => RESERVED_REFUND_STATUSES.has(refund.status)).reduce((sum, refund) => sum + BigInt(refund.amount.amountMinor), 0n),
    [refunds],
  );
  const remainingMinor = (() => {
    const value = BigInt(order.total.amountMinor) - reservedMinor;
    return value > 0n ? value : 0n;
  })();
  const activeReturns = returns.filter((request) => !["REJECTED", "CANCELLED"].includes(request.status));
  const paymentSupportsRefund = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus);
  const canSubmit = canRequest && state === "ready" && paymentSupportsRefund && remainingMinor > 0n;

  function clearAttemptOnEdit() {
    if (attempt) setAttempt(null);
    setSuccess(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const amountMinor = parseNairaToMinor(amount);
    if (!amountMinor || BigInt(amountMinor) <= 0n) {
      setMessage("Enter a valid refund amount greater than zero.");
      return;
    }
    if (BigInt(amountMinor) > remainingMinor) {
      setMessage(`Refund amount exceeds the remaining refundable value of ${formatMoney({ amountMinor: remainingMinor.toString(), currency: order.total.currency })}.`);
      return;
    }
    if (reason.trim().length < 3) {
      setMessage("Enter a refund reason of at least three characters.");
      return;
    }

    const body: CreateRefundBodyDto = {
      amountMinor,
      reason: reason.trim(),
      ...(orderItemId ? { orderItemId } : {}),
      ...(returnRequestId ? { returnRequestId } : {}),
    };
    const fingerprint = requestFingerprint(body);
    const key = attempt?.fingerprint === fingerprint ? attempt.key : idempotencyKey();
    setAttempt({ fingerprint, key });
    setBusy(true);
    setMessage(null);
    setSuccess(false);
    try {
      const refund = await returnsApi.requestVendorRefund(order.id, body, key);
      const refreshed = await load();
      if (refreshed) {
        setAmount("");
        setReason("");
        setOrderItemId("");
        setReturnRequestId("");
        setAttempt(null);
        setMessage(`Refund ${refund.id.slice(0, 8).toUpperCase()} requested. Provider execution remains admin-controlled.`);
        setSuccess(true);
      }
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not submit this refund request. Retry without changing the form to reuse the same idempotency key."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commerceStack" aria-labelledby="vendor-refund-heading">
      <div className="sectionHeadingCompact">
        <div><p className="eyebrow">FP9 refunds</p><h2 id="vendor-refund-heading">Refunds</h2><p>Refund capacity is reserved by requested, approved, processing, and successful refunds. Provider execution is admin-controlled.</p></div>
        <button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>{state === "loading" ? "Refreshing…" : "Refresh"}</button>
      </div>

      {message ? <p className={success ? "formMessage formMessageSuccess" : "formMessage formMessageError"} role="status">{message}</p> : null}
      {state === "error" ? <p className="fieldHint">Refund mutations are disabled until the authoritative refund history loads successfully.</p> : null}

      {state === "ready" ? (
        <div className="orderItemList">
          {refunds.length === 0 ? <p className="formMessage">No refund requests exist for this vendor order.</p> : refunds.map((refund) => (
            <div className="orderItemRow" key={refund.id}>
              <div>
                <strong>{formatMoney(refund.amount)}</strong>
                <span>{refund.reason} · {refund.provider}{refund.providerRefundReference ? ` · ${refund.providerRefundReference}` : ""}</span>
              </div>
              <span className={orderStatusClass(refund.status)}>{orderStatusLabel(refund.status)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {canSubmit ? (
        <form className="panel sellerForm" onSubmit={submit}>
          <div className="sectionHeadingCompact"><div><h3>Request refund</h3><p>Remaining refundable value: {formatMoney({ amountMinor: remainingMinor.toString(), currency: order.total.currency })}</p></div></div>
          <div className="formGrid formGridTwo">
            <label className="field">Amount (NGN)<input inputMode="decimal" value={amount} disabled={busy} onChange={(event) => { setAmount(event.target.value); clearAttemptOnEdit(); }} placeholder="0.00" required /></label>
            <label className="field">Reason<input minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); clearAttemptOnEdit(); }} required /></label>
            <label className="field">Order item scope <span className="fieldHint">Optional</span><select value={orderItemId} disabled={busy} onChange={(event) => { setOrderItemId(event.target.value); clearAttemptOnEdit(); }}><option value="">Whole vendor order / unspecified</option>{order.items.map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.sku}</option>)}</select></label>
            <label className="field">Return request scope <span className="fieldHint">Optional</span><select value={returnRequestId} disabled={busy} onChange={(event) => { setReturnRequestId(event.target.value); clearAttemptOnEdit(); }}><option value="">No return request scope</option>{activeReturns.map((request) => <option key={request.id} value={request.id}>{request.id.slice(0, 8).toUpperCase()} · {orderStatusLabel(request.status)}</option>)}</select></label>
          </div>
          <div className="actionRow"><button className="dangerButton" disabled={busy}>{busy ? "Requesting…" : "Request refund"}</button></div>
          <p className="fieldHint">If a network/provider-adjacent error occurs, retry the unchanged form. CartNest reuses the same client idempotency key for that exact request body.</p>
        </form>
      ) : null}

      {!canRequest ? <p className="fieldHint">Your membership can view refund history but does not include refund:request.</p> : null}
      {canRequest && state === "ready" && !paymentSupportsRefund ? <p className="formMessage">Refund requests require a verified successful payment source.</p> : null}
      {canRequest && state === "ready" && paymentSupportsRefund && remainingMinor === 0n ? <p className="formMessage formMessageSuccess">No refundable value remains on this vendor order.</p> : null}
    </section>
  );
}
