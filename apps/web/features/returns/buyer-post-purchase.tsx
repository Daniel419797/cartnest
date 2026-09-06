"use client";

import type {
  CreateReturnBodyDto,
  OrderDto,
  ReturnItemConditionDto,
  ReturnRequestDto,
  VendorOrderDto,
} from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiErrorCode, apiErrorMessage, returnsApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const RETURN_CONDITIONS: readonly ReturnItemConditionDto[] = [
  "UNOPENED",
  "OPENED",
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "OTHER",
];

function activeReturnQuantity(
  returns: readonly ReturnRequestDto[],
  orderItemId: string,
): number {
  return returns
    .filter((request) => !["REJECTED", "CANCELLED"].includes(request.status))
    .flatMap((request) => request.items)
    .filter((item) => item.orderItemId === orderItemId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function ReviewForm({
  kind,
  targetId,
  label,
}: Readonly<{
  kind: "product" | "store";
  targetId: string;
  label: string;
}>) {
  const [rating, setRating] = useState("5");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      setMessage("Choose a rating from 1 to 5.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "product") {
        await returnsApi.createProductReview({
          orderItemId: targetId,
          rating: parsedRating,
          ...(text.trim() ? { text: text.trim() } : {}),
        });
      } else {
        await returnsApi.createStoreReview({
          vendorOrderId: targetId,
          rating: parsedRating,
          ...(text.trim() ? { text: text.trim() } : {}),
        });
      }
      setSubmitted(true);
      setMessage("Review submitted for moderation.");
    } catch (caught) {
      if (apiErrorCode(caught) === "REVIEW_ALREADY_EXISTS") {
        setSubmitted(true);
        setMessage("You already submitted a verified review for this purchase.");
      } else {
        setMessage(apiErrorMessage(caught, "CartNest could not submit this review."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (submitted) return <p className="formMessage formMessageSuccess">{message}</p>;

  return (
    <form className="commerceStack" onSubmit={submit}>
      <strong>{label}</strong>
      <div className="formGrid formGridTwo">
        <label className="field">Rating
          <select value={rating} onChange={(event) => setRating(event.target.value)} disabled={busy}>
            <option value="5">5 — Excellent</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Okay</option>
            <option value="2">2 — Poor</option>
            <option value="1">1 — Very poor</option>
          </select>
        </label>
        <label className="field">Comment <span className="fieldHint">Optional</span>
          <input minLength={2} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} />
        </label>
      </div>
      <div className="actionRow"><button className="secondaryButton" disabled={busy}>{busy ? "Submitting…" : "Submit verified review"}</button></div>
      {message ? <p className="formMessage" role="status">{message}</p> : null}
    </form>
  );
}

function ReturnForm({
  vendorOrder,
  existingReturns,
  disabled,
  onCreated,
}: Readonly<{
  vendorOrder: VendorOrderDto;
  existingReturns: readonly ReturnRequestDto[];
  disabled: boolean;
  onCreated: () => Promise<void>;
}>) {
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<Record<string, ReturnItemConditionDto>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const remainingByItem = useMemo(
    () => new Map(vendorOrder.items.map((item) => [
      item.id,
      Math.max(0, item.quantity - activeReturnQuantity(existingReturns, item.id)),
    ])),
    [existingReturns, vendorOrder.items],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (reason.trim().length < 3) {
      setMessage("Describe the reason for the return.");
      return;
    }

    const items: CreateReturnBodyDto["items"] = [];
    for (const item of vendorOrder.items) {
      const raw = quantities[item.id]?.trim() ?? "";
      if (!raw) continue;
      const quantity = Number(raw);
      const remaining = remainingByItem.get(item.id) ?? 0;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) {
        setMessage(`Enter a whole return quantity between 1 and ${remaining} for ${item.productName}.`);
        return;
      }
      items.push({
        orderItemId: item.id,
        quantity,
        ...(conditions[item.id] ? { condition: conditions[item.id] } : {}),
      });
    }
    if (items.length === 0) {
      setMessage("Choose at least one item and quantity to return.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await returnsApi.createReturn({ vendorOrderId: vendorOrder.id, reason: reason.trim(), items });
      setReason("");
      setQuantities({});
      setConditions({});
      await onCreated();
      setMessage("Return request submitted. The store can now review it.");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not create this return request."));
    } finally {
      setBusy(false);
    }
  }

  const returnableUnits = [...remainingByItem.values()].reduce((sum, value) => sum + value, 0);
  if (returnableUnits === 0) {
    return <p className="formMessage">All purchased units in this store order are already covered by active return requests.</p>;
  }

  return (
    <form className="panel sellerForm" onSubmit={submit}>
      <div className="sectionHeadingCompact"><div><h3>Request a return</h3><p>Returns begin only after delivery. CartNest validates cumulative quantities again on the server.</p></div><span className="statusPill">{returnableUnits} unit(s) returnable</span></div>
      <label className="field">Overall reason<textarea rows={3} minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || disabled} required /></label>
      <div className="orderItemList">
        {vendorOrder.items.map((item) => {
          const remaining = remainingByItem.get(item.id) ?? 0;
          return (
            <div className="orderItemRow" key={item.id}>
              <div><strong>{item.productName}</strong><span>{item.sku} · {remaining} of {item.quantity} returnable</span></div>
              <div className="formGrid formGridTwo">
                <label className="field">Qty<input type="number" min={remaining > 0 ? 1 : 0} max={remaining} value={quantities[item.id] ?? ""} disabled={busy || disabled || remaining === 0} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                <label className="field">Condition<select value={conditions[item.id] ?? ""} disabled={busy || disabled || remaining === 0} onChange={(event) => setConditions((current) => ({ ...current, [item.id]: event.target.value as ReturnItemConditionDto }))}><option value="">Not specified</option>{RETURN_CONDITIONS.map((condition) => <option key={condition} value={condition}>{orderStatusLabel(condition)}</option>)}</select></label>
              </div>
            </div>
          );
        })}
      </div>
      <div className="actionRow"><button className="primaryButton" disabled={busy || disabled}>{busy ? "Submitting…" : "Submit return request"}</button></div>
      {message ? <p className="formMessage" role="status">{message}</p> : null}
    </form>
  );
}

export function BuyerPostPurchase({ order }: Readonly<{ order: OrderDto }>) {
  const [returns, setReturns] = useState<readonly ReturnRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setMessage(null);
    try {
      const responses = await Promise.all(order.vendorOrders.map((vendorOrder) =>
        returnsApi.listMyReturns({ vendorOrderId: vendorOrder.id, pageSize: 100 }),
      ));
      setReturns(responses.flatMap((response) => response.items));
    } catch (caught) {
      setLoadFailed(true);
      setMessage(apiErrorMessage(caught, "CartNest could not load return history for this order."));
    } finally {
      setLoading(false);
    }
  }, [order.vendorOrders]);

  useEffect(() => { void load(); }, [load]);

  const delivered = order.vendorOrders.filter((vendorOrder) => vendorOrder.status === "DELIVERED");
  if (delivered.length === 0) return null;

  return (
    <section className="commerceStack" aria-labelledby="post-purchase-heading">
      <div className="sectionHeadingCompact">
        <div><p className="eyebrow">FP9 post-purchase</p><h2 id="post-purchase-heading">Returns & reviews</h2><p>Return and review eligibility is verified from delivered purchase records on the backend.</p></div>
        <button className="secondaryButton" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {loadFailed ? <p className="fieldHint">New return requests are disabled until existing return allocations can be loaded safely.</p> : null}

      {delivered.map((vendorOrder) => {
        const vendorReturns = returns.filter((request) => request.vendorOrderId === vendorOrder.id);
        return (
          <div className="commerceStack" key={vendorOrder.id}>
            <div className="sectionHeadingCompact"><div><h3>{vendorOrder.store.name}</h3><p>{vendorOrder.store.vendorDisplayName}</p></div><span className={orderStatusClass(vendorOrder.status)}>{orderStatusLabel(vendorOrder.status)}</span></div>

            {vendorReturns.length > 0 ? (
              <div className="orderItemList">
                {vendorReturns.map((request) => (
                  <div className="orderItemRow" key={request.id}>
                    <div><strong>Return {request.id.slice(0, 8).toUpperCase()}</strong><span>{request.reason} · {request.items.reduce((sum, item) => sum + item.quantity, 0)} unit(s)</span></div>
                    <span className={orderStatusClass(request.status)}>{orderStatusLabel(request.status)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <ReturnForm vendorOrder={vendorOrder} existingReturns={vendorReturns} disabled={loadFailed || loading} onCreated={load} />

            <article className="panel sellerForm">
              <div className="sectionHeadingCompact"><div><h3>Verified-purchase reviews</h3><p>New reviews remain pending until moderation approves them for public display.</p></div></div>
              <ReviewForm kind="store" targetId={vendorOrder.id} label={`Review ${vendorOrder.store.name}`} />
              {vendorOrder.items.map((item) => <ReviewForm key={item.id} kind="product" targetId={item.id} label={`Review ${item.productName}`} />)}
            </article>
          </div>
        );
      })}
    </section>
  );
}
