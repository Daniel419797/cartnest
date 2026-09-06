"use client";

import type { PromotionDto, PromotionStatusDto, PromotionTypeDto, TaxRateDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { adminApi, apiErrorMessage } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";
import { localDateTimeToIso, nairaToMinor, percentageToBps } from "./admin-utils";

export function AdminCommercialPolicy() {
  const [taxRates, setTaxRates] = useState<readonly TaxRateDto[]>([]);
  const [promotions, setPromotions] = useState<readonly PromotionDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [taxName, setTaxName] = useState("Nigeria VAT");
  const [taxPercent, setTaxPercent] = useState("7.5");
  const [taxStartsAt, setTaxStartsAt] = useState("");
  const [taxEndsAt, setTaxEndsAt] = useState("");
  const [taxActive, setTaxActive] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");
  const [promotionName, setPromotionName] = useState("");
  const [promotionType, setPromotionType] = useState<PromotionTypeDto>("PERCENTAGE");
  const [promotionValue, setPromotionValue] = useState("");
  const [promotionMinOrder, setPromotionMinOrder] = useState("");
  const [promotionMax, setPromotionMax] = useState("");
  const [promotionPerUser, setPromotionPerUser] = useState("");
  const [promotionStartsAt, setPromotionStartsAt] = useState("");
  const [promotionEndsAt, setPromotionEndsAt] = useState("");
  const [promotionStatus, setPromotionStatus] = useState<PromotionStatusDto>("DRAFT");

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const [taxResponse, promotionResponse] = await Promise.all([adminApi.listTaxRates(), adminApi.listPromotions()]);
      setTaxRates(taxResponse.items);
      setPromotions(promotionResponse.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load tax and promotion policy."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createTax() {
    const rateBps = percentageToBps(taxPercent);
    const startsAt = localDateTimeToIso(taxStartsAt);
    const endsAt = localDateTimeToIso(taxEndsAt);
    if (!taxName.trim() || rateBps === undefined) {
      setMessage("Enter a tax name and a percentage from 0 to 100 with at most two decimals.");
      return;
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setMessage("Tax end time must be after its start time.");
      return;
    }
    setBusyId("new-tax");
    setMessage(null);
    try {
      await adminApi.createTaxRate({ name: taxName.trim(), rateBps, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}), active: taxActive });
      setTaxEndsAt("");
      setTaxActive(false);
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not create this tax policy."));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTax(tax: TaxRateDto) {
    setBusyId(tax.id);
    setMessage(null);
    try {
      await adminApi.setTaxRateActive(tax.id, !tax.active);
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not change this tax policy."));
    } finally {
      setBusyId(null);
    }
  }

  async function createPromotion() {
    const startsAt = localDateTimeToIso(promotionStartsAt);
    const endsAt = localDateTimeToIso(promotionEndsAt);
    const value = promotionType === "PERCENTAGE" ? percentageToBps(promotionValue)?.toString() : nairaToMinor(promotionValue);
    const minOrderAmountMinor = promotionMinOrder ? nairaToMinor(promotionMinOrder) : undefined;
    const maxRedemptions = promotionMax ? Number(promotionMax) : undefined;
    const perUserLimit = promotionPerUser ? Number(promotionPerUser) : undefined;
    if (!promotionCode.trim() || !promotionName.trim() || !startsAt || !value || value === "0") {
      setMessage("Promotion code, name, valid start time, and positive discount value are required.");
      return;
    }
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setMessage("Promotion end time must be after its start time.");
      return;
    }
    if (promotionMax && (!Number.isInteger(maxRedemptions) || (maxRedemptions ?? 0) < 1)) {
      setMessage("Global redemption limit must be a positive whole number.");
      return;
    }
    if (promotionPerUser && (!Number.isInteger(perUserLimit) || (perUserLimit ?? 0) < 1)) {
      setMessage("Per-user redemption limit must be a positive whole number.");
      return;
    }
    if (promotionMinOrder && minOrderAmountMinor === undefined) {
      setMessage("Minimum order amount must be a valid Naira amount.");
      return;
    }
    setBusyId("new-promotion");
    setMessage(null);
    try {
      await adminApi.createPromotion({
        code: promotionCode.trim(),
        name: promotionName.trim(),
        type: promotionType,
        value,
        ...(promotionType === "FIXED_AMOUNT" ? { currency: "NGN" } : {}),
        ...(minOrderAmountMinor !== undefined ? { minOrderAmountMinor } : {}),
        ...(maxRedemptions !== undefined ? { maxRedemptions } : {}),
        ...(perUserLimit !== undefined ? { perUserLimit } : {}),
        startsAt,
        ...(endsAt ? { endsAt } : {}),
        status: promotionStatus,
      });
      setPromotionCode("");
      setPromotionName("");
      setPromotionValue("");
      setPromotionMinOrder("");
      setPromotionMax("");
      setPromotionPerUser("");
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not create this promotion."));
    } finally {
      setBusyId(null);
    }
  }

  async function changePromotionStatus(promotion: PromotionDto, status: PromotionStatusDto) {
    setBusyId(promotion.id);
    setMessage(null);
    try {
      await adminApi.setPromotionStatus(promotion.id, status);
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not update this promotion."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="commerceStack" aria-labelledby="commercial-policy-heading">
      <div className="sectionHeadingCompact"><div><h2 id="commercial-policy-heading">Tax & promotions</h2><p>Privileged commercial policy changes are server-authorized, MFA-gated, and audited.</p></div><button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>{state === "loading" ? "Refreshing…" : "Refresh"}</button></div>
      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {state === "loading" ? <LoadingState label="Loading commercial policy…" /> : null}
      {state === "error" ? <ErrorState title="Commercial policy unavailable" message={message ?? "CartNest could not load policy."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}
      {state === "ready" ? (
        <>
          <div className="formGrid formGridTwo">
            <article className="panel sellerForm">
              <h3>Create tax rate</h3>
              <label className="field">Policy name<input maxLength={160} value={taxName} onChange={(event) => setTaxName(event.target.value)} /></label>
              <label className="field">Rate (%)<input inputMode="decimal" value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} /></label>
              <label className="field">Starts at <span className="fieldHint">Optional; server uses now if blank</span><input type="datetime-local" value={taxStartsAt} onChange={(event) => setTaxStartsAt(event.target.value)} /></label>
              <label className="field">Ends at <span className="fieldHint">Optional</span><input type="datetime-local" value={taxEndsAt} onChange={(event) => setTaxEndsAt(event.target.value)} /></label>
              <label className="field"><span><input type="checkbox" checked={taxActive} onChange={(event) => setTaxActive(event.target.checked)} /> Make this the active platform tax policy</span></label>
              <button className="primaryButton" type="button" disabled={busyId !== null} onClick={() => void createTax()}>{busyId === "new-tax" ? "Creating…" : "Create tax policy"}</button>
            </article>
            <article className="panel sellerForm">
              <h3>Tax policies</h3>
              {taxRates.length === 0 ? <p>No tax policies exist.</p> : taxRates.map((tax) => <div className="orderItemRow" key={tax.id}><div><strong>{tax.name}</strong><span>{(tax.rateBps / 100).toFixed(2)}% · starts {new Date(tax.startsAt).toLocaleString()}{tax.endsAt ? ` · ends ${new Date(tax.endsAt).toLocaleString()}` : ""}</span></div><button className={tax.active ? "dangerButton compactButton" : "secondaryButton compactButton"} type="button" disabled={busyId !== null} onClick={() => void toggleTax(tax)}>{busyId === tax.id ? "Saving…" : tax.active ? "Deactivate" : "Activate"}</button></div>)}
            </article>
          </div>
          <div className="formGrid formGridTwo">
            <article className="panel sellerForm">
              <h3>Create promotion</h3>
              <div className="formGrid formGridTwo"><label className="field">Code<input maxLength={64} value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} /></label><label className="field">Name<input maxLength={160} value={promotionName} onChange={(event) => setPromotionName(event.target.value)} /></label></div>
              <div className="formGrid formGridTwo"><label className="field">Type<select value={promotionType} onChange={(event) => setPromotionType(event.target.value as PromotionTypeDto)}><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed amount</option></select></label><label className="field">{promotionType === "PERCENTAGE" ? "Discount (%)" : "Discount (₦)"}<input inputMode="decimal" value={promotionValue} onChange={(event) => setPromotionValue(event.target.value)} /></label></div>
              <label className="field">Minimum order (₦) <span className="fieldHint">Optional</span><input inputMode="decimal" value={promotionMinOrder} onChange={(event) => setPromotionMinOrder(event.target.value)} /></label>
              <div className="formGrid formGridTwo"><label className="field">Global limit <span className="fieldHint">Optional</span><input type="number" min={1} value={promotionMax} onChange={(event) => setPromotionMax(event.target.value)} /></label><label className="field">Per-user limit <span className="fieldHint">Optional</span><input type="number" min={1} value={promotionPerUser} onChange={(event) => setPromotionPerUser(event.target.value)} /></label></div>
              <div className="formGrid formGridTwo"><label className="field">Starts at<input type="datetime-local" value={promotionStartsAt} onChange={(event) => setPromotionStartsAt(event.target.value)} /></label><label className="field">Ends at <span className="fieldHint">Optional</span><input type="datetime-local" value={promotionEndsAt} onChange={(event) => setPromotionEndsAt(event.target.value)} /></label></div>
              <label className="field">Initial status<select value={promotionStatus} onChange={(event) => setPromotionStatus(event.target.value as PromotionStatusDto)}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="EXPIRED">Expired</option></select></label>
              <button className="primaryButton" type="button" disabled={busyId !== null} onClick={() => void createPromotion()}>{busyId === "new-promotion" ? "Creating…" : "Create promotion"}</button>
            </article>
            <article className="panel sellerForm">
              <h3>Promotions</h3>
              {promotions.length === 0 ? <p>No promotions exist.</p> : promotions.map((promotion) => <div className="sellerForm" key={promotion.id}><div className="sectionHeadingCompact"><div><strong>{promotion.code} · {promotion.name}</strong><p>{promotion.type === "PERCENTAGE" ? `${(Number(promotion.value) / 100).toFixed(2)}%` : formatMoney({ amountMinor: promotion.value, currency: promotion.currency ?? "NGN" })} · starts {new Date(promotion.startsAt).toLocaleString()}</p></div><span className={orderStatusClass(promotion.status)}>{orderStatusLabel(promotion.status)}</span></div><label className="field">Status<select value={promotion.status} disabled={busyId !== null} onChange={(event) => void changePromotionStatus(promotion, event.target.value as PromotionStatusDto)}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option><option value="EXPIRED">Expired</option></select></label></div>)}
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
