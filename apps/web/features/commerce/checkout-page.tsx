"use client";

import type {
  CartResponseDto,
  CheckoutPreviewResponseDto,
  DeliveryAddressSnapshotDto,
  LogisticsStationDto,
  ShippingQuoteResponseDto,
} from "@repo/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import {
  apiErrorCode,
  apiErrorMessage,
  cartApi,
  logisticsApi,
  ordersApi,
} from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";

const EMPTY_ADDRESS: DeliveryAddressSnapshotDto = {
  recipientName: "",
  phone: "",
  line1: "",
  city: "",
  state: "",
  countryCode: "NG",
};

function normalizedAddress(address: DeliveryAddressSnapshotDto): DeliveryAddressSnapshotDto {
  return {
    recipientName: address.recipientName.trim(),
    phone: address.phone.trim(),
    line1: address.line1.trim(),
    ...(address.line2?.trim() ? { line2: address.line2.trim() } : {}),
    city: address.city.trim(),
    state: address.state.trim(),
    ...(address.postalCode?.trim() ? { postalCode: address.postalCode.trim() } : {}),
    countryCode: address.countryCode.trim().toUpperCase(),
  };
}

function hasRequiredAddress(address: DeliveryAddressSnapshotDto): boolean {
  const normalized = normalizedAddress(address);
  return (
    normalized.recipientName.length >= 2 &&
    normalized.phone.length >= 7 &&
    normalized.line1.length >= 2 &&
    normalized.city.length >= 2 &&
    normalized.state.length >= 2 &&
    normalized.countryCode === "NG"
  );
}

function shippingTotal(quote: ShippingQuoteResponseDto): { amountMinor: string; currency: string } | null {
  const selected = quote.groups.flatMap((group) => group.quotes.slice(0, 1));
  if (selected.length === 0) return null;
  const currency = selected[0]!.amount.currency;
  if (selected.some((item) => item.amount.currency !== currency)) return null;
  const amount = selected.reduce((sum, item) => sum + BigInt(item.amount.amountMinor), 0n);
  return { amountMinor: amount.toString(), currency };
}

export function CheckoutPageContent() {
  const router = useRouter();
  const [cart, setCart] = useState<CartResponseDto | null>(null);
  const [preview, setPreview] = useState<CheckoutPreviewResponseDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [address, setAddress] = useState<DeliveryAddressSnapshotDto>(EMPTY_ADDRESS);
  const [promotionCode, setPromotionCode] = useState("");
  const [quote, setQuote] = useState<ShippingQuoteResponseDto | null>(null);
  const [stations, setStations] = useState<readonly LogisticsStationDto[] | null>(null);
  const [receiverStationId, setReceiverStationId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"quote" | "order" | null>(null);
  const checkoutKey = useRef<{ payload: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const [nextCart, nextPreview] = await Promise.all([cartApi.get(), cartApi.previewCheckout()]);
      setCart(nextCart);
      setPreview(nextPreview);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load checkout."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function invalidateDeliveryQuote() {
    setQuote(null);
  }

  function setAddressField<K extends keyof DeliveryAddressSnapshotDto>(
    key: K,
    value: DeliveryAddressSnapshotDto[K],
  ) {
    setAddress((current) => ({ ...current, [key]: value }));
    invalidateDeliveryQuote();
    setMessage(null);
  }

  async function loadStations(): Promise<boolean> {
    if (stations !== null) return true;
    try {
      const response = await logisticsApi.listStations();
      setStations(response.items);
      if (response.items.length === 0) {
        setMessage("GIGL did not return any receiver stations. Delivery cannot be quoted for the GIGL store right now.");
        return false;
      }
      return true;
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load GIGL receiver stations."));
      return false;
    }
  }

  async function requestDeliveryQuote(): Promise<ShippingQuoteResponseDto | null> {
    const deliveryAddress = normalizedAddress(address);
    if (!hasRequiredAddress(deliveryAddress)) {
      setMessage("Complete the recipient name, phone, street address, city and state before calculating delivery.");
      return null;
    }

    setBusy((current) => current ?? "quote");
    setMessage(null);
    try {
      const next = await logisticsApi.quoteCart({
        deliveryAddress,
        ...(receiverStationId ? { receiverStationId: Number(receiverStationId) } : {}),
      });
      setQuote(next);
      return next;
    } catch (caught) {
      if (apiErrorCode(caught) === "GIGL_STATION_REQUIRED") {
        const loaded = await loadStations();
        if (loaded) {
          setMessage("A store in this cart ships with GIGL. Select your receiver station, then calculate delivery again.");
        }
      } else {
        setMessage(apiErrorMessage(caught, "CartNest could not calculate delivery for this cart."));
      }
      setQuote(null);
      return null;
    } finally {
      setBusy((current) => current === "quote" ? null : current);
    }
  }

  function idempotencyKeyFor(payload: string): string {
    if (!checkoutKey.current || checkoutKey.current.payload !== payload) {
      checkoutKey.current = { payload, key: crypto.randomUUID() };
    }
    return checkoutKey.current.key;
  }

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart || !preview?.ready || cart.items.length === 0) return;

    setBusy("order");
    setMessage(null);
    try {
      const deliveryAddress = normalizedAddress(address);
      // Always refresh delivery immediately before creating the order. The backend
      // independently resolves the latest matching unexpired quote and remains authoritative.
      const currentQuote = await requestDeliveryQuote();
      if (!currentQuote) return;

      const body = {
        deliveryAddress,
        ...(promotionCode.trim() ? { promotionCode: promotionCode.trim().toUpperCase() } : {}),
      };
      const payload = JSON.stringify(body);
      const order = await ordersApi.checkout(body, idempotencyKeyFor(payload));
      checkoutKey.current = null;
      router.push(`/orders/${encodeURIComponent(order.id)}`);
    } catch (caught) {
      const code = apiErrorCode(caught);
      if (["CHECKOUT_REVALIDATION_REQUIRED", "INSUFFICIENT_STOCK"].includes(code ?? "")) {
        setMessage(`${apiErrorMessage(caught, "Your cart changed during checkout.")} Return to the cart, review the latest quantities, and retry.`);
      } else if (code === "SHIPPING_QUOTE_REQUIRED") {
        invalidateDeliveryQuote();
        setMessage("The delivery quote expired or no longer matches this address. Calculate delivery again before retrying.");
      } else {
        setMessage(apiErrorMessage(caught, "CartNest could not create your order."));
      }
    } finally {
      setBusy(null);
    }
  }

  const quoteTotal = useMemo(() => quote ? shippingTotal(quote) : null, [quote]);
  const quoteStoreNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of cart?.items ?? []) names.set(item.product.store.id, item.product.store.name);
    return names;
  }, [cart]);

  if (state === "loading") return <main className="commercePage"><LoadingState label="Preparing checkout…" /></main>;
  if (state === "error" || !cart) {
    return <main className="commercePage"><ErrorState title="Checkout unavailable" message={message ?? "CartNest could not prepare checkout."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;
  }
  if (cart.items.length === 0) {
    return <main className="commercePage"><EmptyState title="Nothing to check out" message="Your active cart does not contain any available items." action={<Link className="primaryButton" href="/marketplace">Browse marketplace</Link>} /></main>;
  }

  return (
    <main className="commercePage checkoutPage">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Checkout</p>
          <h1 className="pageTitle">Delivery & order</h1>
          <p className="muted">Enter delivery details, calculate shipping, and create the order. CartNest revalidates price, stock, promotions, tax and delivery on the server.</p>
        </div>
        <Link className="secondaryButton" href="/cart">← Back to cart</Link>
      </div>

      <nav className="commerceStepRail" aria-label="Checkout progress">
        <span className="commerceStep commerceStepDone"><b>✓</b> Cart</span>
        <span className="commerceStep commerceStepActive"><b>2</b> Delivery</span>
        <span className="commerceStep"><b>3</b> Shipping</span>
        <span className="commerceStep"><b>4</b> Payment</span>
      </nav>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}

      {!preview?.ready ? (
        <ErrorState title="Cart is not ready for checkout" message="Resolve the current cart availability issues before creating an order." action={<Link className="primaryButton" href="/cart">Review cart</Link>} />
      ) : (
        <form className="commerceLayout checkoutLayout" onSubmit={submitCheckout}>
          <div className="commerceStack">
            <section className="panel checkoutSection">
              <div className="sectionHeadingCompact">
                <div><p className="eyebrow">Step 1</p><h2>Delivery address</h2></div>
                <span className="statusPill">Nigeria</span>
              </div>
              <div className="checkoutFieldGrid">
                <label className="field">Recipient name<input required minLength={2} maxLength={160} autoComplete="name" value={address.recipientName} onChange={(event) => setAddressField("recipientName", event.target.value)} /></label>
                <label className="field">Phone<input required minLength={7} maxLength={32} autoComplete="tel" value={address.phone} onChange={(event) => setAddressField("phone", event.target.value)} /></label>
                <label className="field checkoutFieldWide">Address line 1<input required minLength={2} maxLength={240} autoComplete="address-line1" value={address.line1} onChange={(event) => setAddressField("line1", event.target.value)} /></label>
                <label className="field checkoutFieldWide">Address line 2 <span className="fieldHint">Optional</span><input maxLength={240} autoComplete="address-line2" value={address.line2 ?? ""} onChange={(event) => setAddressField("line2", event.target.value || undefined)} /></label>
                <label className="field">City<input required minLength={2} maxLength={120} autoComplete="address-level2" value={address.city} onChange={(event) => setAddressField("city", event.target.value)} /></label>
                <label className="field">State<input required minLength={2} maxLength={120} autoComplete="address-level1" value={address.state} onChange={(event) => setAddressField("state", event.target.value)} /></label>
                <label className="field">Postal code <span className="fieldHint">Optional</span><input maxLength={32} autoComplete="postal-code" value={address.postalCode ?? ""} onChange={(event) => setAddressField("postalCode", event.target.value || undefined)} /></label>
                <label className="field">Country<input value="Nigeria (NG)" readOnly aria-label="Country" /></label>
              </div>
            </section>

            <section className="panel checkoutSection">
              <div className="sectionHeadingCompact">
                <div><p className="eyebrow">Step 2</p><h2>Delivery quote</h2></div>
              </div>
              <p className="muted">Manual-delivery stores use their configured fee. GIGL stores require a receiver station before CartNest can request a delivery price.</p>

              {stations !== null ? (
                <label className="field checkoutStationField">GIGL receiver station
                  <select required value={receiverStationId} onChange={(event) => { setReceiverStationId(event.target.value); invalidateDeliveryQuote(); }}>
                    <option value="">Select a receiver station</option>
                    {stations.map((station) => <option key={station.id} value={station.id}>{station.name}{station.state ? ` · ${station.state}` : ""}</option>)}
                  </select>
                </label>
              ) : null}

              <div className="actionRow">
                <button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => void requestDeliveryQuote()}>{busy === "quote" ? "Calculating…" : quote ? "Refresh delivery quote" : "Calculate delivery"}</button>
              </div>

              {quote ? (
                <div className="deliveryQuoteList" aria-live="polite">
                  {quote.groups.map((group) => {
                    const selected = group.quotes[0];
                    if (!selected) return null;
                    return (
                      <div className="deliveryQuoteRow" key={group.storeId}>
                        <div><strong>{quoteStoreNames.get(group.storeId) ?? "Store delivery"}</strong><span>{selected.provider === "GIGL" ? "GIG Logistics" : "Vendor-managed delivery"}{selected.serviceCode ? ` · ${selected.serviceCode}` : ""}</span></div>
                        <strong>{formatMoney(selected.amount)}</strong>
                      </div>
                    );
                  })}
                  {quoteTotal ? <div className="deliveryQuoteRow deliveryQuoteTotal"><span>Total quoted delivery</span><strong>{formatMoney(quoteTotal)}</strong></div> : null}
                </div>
              ) : null}
            </section>

            <section className="panel checkoutSection">
              <div className="sectionHeadingCompact"><div><p className="eyebrow">Optional</p><h2>Promotion</h2></div></div>
              <label className="field">Promotion code<input minLength={2} maxLength={64} pattern="[A-Za-z0-9_-]+" value={promotionCode} onChange={(event) => { setPromotionCode(event.target.value); checkoutKey.current = null; }} placeholder="SAVE10" /></label>
              <p className="fieldHint">The backend revalidates status, dates, limits and minimum-order rules while the order transaction is being created.</p>
            </section>
          </div>

          <aside className="commerceSummary checkoutSummary" aria-label="Checkout summary">
            <h2>Order summary</h2>
            <div className="summaryRows">
              <div className="summaryRow"><span>Units</span><strong>{cart.itemCount}</strong></div>
              <div className="summaryRow"><span>Stores</span><strong>{cart.distinctStoreCount}</strong></div>
              <div className="summaryRow"><span>Items subtotal</span><strong>{formatMoney(cart.subtotal)}</strong></div>
              {quoteTotal ? <div className="summaryRow"><span>Quoted delivery</span><strong>{formatMoney(quoteTotal)}</strong></div> : null}
            </div>
            <p className="fieldHint">The final order total is server-calculated and may also include validated promotion discounts and configured tax. The browser cannot override these amounts.</p>
            <button className="primaryButton" type="submit" disabled={busy !== null}>{busy === "order" ? "Creating order…" : "Create order"}</button>
            <p className="fieldHint">Creating the order reserves variant inventory for 15 minutes. Payment handoff is the next integration phase; order creation itself does not claim payment success.</p>
          </aside>
        </form>
      )}
    </main>
  );
}
