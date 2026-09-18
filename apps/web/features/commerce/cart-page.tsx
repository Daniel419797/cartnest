"use client";

import type {
  CartItemDto,
  CartResponseDto,
  CheckoutPreviewResponseDto,
} from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, cartApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";

function variantLabel(item: CartItemDto): string {
  if (item.variant.optionValues.length === 0) return "Standard variant";
  return item.variant.optionValues.map((selection) => `${selection.optionName}: ${selection.value}`).join(" · ");
}

function CartLine({
  item,
  busy,
  onUpdate,
  onRemove,
}: Readonly<{
  item: CartItemDto;
  busy: boolean;
  onUpdate: (itemId: string, quantity: number) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
}>) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setQuantity(String(item.quantity)), [item.quantity]);

  async function updateQuantity() {
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      setMessage("Quantity must be a whole number between 1 and 1000.");
      return;
    }
    if (parsed > item.availableQuantity) {
      setMessage(`Only ${item.availableQuantity} unit(s) are currently available.`);
      return;
    }
    if (parsed === item.quantity) {
      setMessage("Quantity is already up to date.");
      return;
    }
    setMessage(null);
    await onUpdate(item.id, parsed);
  }

  const image = item.product.media[0];

  return (
    <article className="cartLine">
      <div className="cartLineImage">
        {image ? <img src={image.url} alt={image.altText ?? item.product.name} loading="lazy" decoding="async" fetchPriority="low" /> : <span className="commerceImageFallback">CN</span>}
      </div>
      <div className="cartLineBody">
        <h3><Link href={`/products/${encodeURIComponent(item.product.id)}`}>{item.product.name}</Link></h3>
        <p className="variantLabel">{variantLabel(item)}</p>
        <p className="variantLabel">SKU {item.variant.sku} · {item.availableQuantity} available</p>
        {message ? <p className="variantLabel" role="status">{message}</p> : null}
      </div>
      <div className="cartLineActions">
        <strong>{formatMoney(item.lineSubtotal)}</strong>
        <div className="quantityEditor">
          <input
            aria-label={`Quantity for ${item.product.name}`}
            type="number"
            min={1}
            max={Math.max(1, item.availableQuantity)}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={busy}
          />
          <button className="secondaryButton compactButton" type="button" disabled={busy} onClick={() => void updateQuantity()}>
            Update
          </button>
        </div>
        <button className="textDangerButton" type="button" disabled={busy} onClick={() => void onRemove(item.id)}>
          Remove
        </button>
      </div>
    </article>
  );
}

export function CartPageContent() {
  const [cart, setCart] = useState<CartResponseDto | null>(null);
  const [preview, setPreview] = useState<CheckoutPreviewResponseDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const [nextCart, nextPreview] = await Promise.all([cartApi.get(), cartApi.previewCheckout()]);
      setCart(nextCart);
      setPreview(nextPreview);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load your cart."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refreshPreview(nextCart: CartResponseDto) {
    setCart(nextCart);
    try {
      setPreview(await cartApi.previewCheckout());
    } catch (caught) {
      setPreview(null);
      setMessage(apiErrorMessage(caught, "Your cart changed, but CartNest could not refresh checkout readiness."));
    }
  }

  async function updateItem(itemId: string, quantity: number) {
    setBusyItem(itemId);
    setMessage(null);
    try {
      await refreshPreview(await cartApi.updateItem(itemId, { quantity }));
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not update this quantity."));
    } finally {
      setBusyItem(null);
    }
  }

  async function removeItem(itemId: string) {
    setBusyItem(itemId);
    setMessage(null);
    try {
      await refreshPreview(await cartApi.removeItem(itemId));
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not remove this item."));
    } finally {
      setBusyItem(null);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, { store: CartItemDto["product"]["store"]; items: CartItemDto[] }>();
    for (const item of cart?.items ?? []) {
      const current = map.get(item.product.store.id);
      if (current) current.items.push(item);
      else map.set(item.product.store.id, { store: item.product.store, items: [item] });
    }
    return [...map.values()];
  }, [cart]);

  if (state === "loading") return <main className="commercePage"><LoadingState label="Loading your cart…" /></main>;
  if (state === "error" || !cart) {
    return <main className="commercePage"><ErrorState title="Cart unavailable" message={message ?? "CartNest could not load your cart."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;
  }

  const hasAnyItems = cart.items.length > 0 || cart.unavailableItems.length > 0;

  return (
    <main className="commercePage">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Shopping bag</p>
          <h1 className="pageTitle">Your cart</h1>
          <p className="muted">Review items from every store before moving into CartNest checkout.</p>
        </div>
        <Link className="secondaryButton" href="/marketplace">Continue shopping</Link>
      </div>

      <nav className="commerceStepRail" aria-label="Checkout progress">
        <span className="commerceStep commerceStepActive"><b>1</b> Cart</span>
        <span className="commerceStep"><b>2</b> Delivery</span>
        <span className="commerceStep"><b>3</b> Shipping</span>
        <span className="commerceStep"><b>4</b> Payment</span>
      </nav>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}

      {!hasAnyItems ? (
        <EmptyState title="Your cart is empty" message="Browse the marketplace and add a product variant when you are ready." action={<Link className="primaryButton" href="/marketplace">Browse marketplace</Link>} />
      ) : (
        <div className="commerceLayout">
          <div className="commerceStack">
            {groups.map((group) => (
              <section className="storeGroup" key={group.store.id}>
                <div className="storeGroupHeader">
                  <div><h2>{group.store.name}</h2><span>{group.store.vendorDisplayName}</span></div>
                  <span>{group.items.reduce((total, item) => total + item.quantity, 0)} item(s)</span>
                </div>
                {group.items.map((item) => (
                  <CartLine
                    key={item.id}
                    item={item}
                    busy={busyItem === item.id}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                  />
                ))}
              </section>
            ))}

            {cart.unavailableItems.length > 0 ? (
              <section className="unavailableSection">
                <div><h2>Items requiring attention</h2><p className="variantLabel">These lines remain visible so you can remove stale or unavailable items instead of leaving hidden records in your cart.</p></div>
                {cart.unavailableItems.map((item) => (
                  <article className="unavailableCard" key={item.id}>
                    <div>
                      <strong>{item.productName ?? `Unavailable variant ${item.variantId.slice(0, 8)}`}</strong>
                      <p>{item.message}{item.sku ? ` · SKU ${item.sku}` : ""}</p>
                    </div>
                    <button className="dangerButton compactButton" type="button" disabled={busyItem === item.id} onClick={() => void removeItem(item.id)}>
                      Remove item
                    </button>
                  </article>
                ))}
              </section>
            ) : null}
          </div>

          <aside className="commerceSummary" aria-label="Cart summary">
            <h2>Summary</h2>
            <div className="summaryRows">
              <div className="summaryRow"><span>Units</span><strong>{cart.itemCount}</strong></div>
              <div className="summaryRow"><span>Stores</span><strong>{cart.distinctStoreCount}</strong></div>
              <div className="summaryRow summaryTotal"><span>Current subtotal</span><strong>{formatMoney(cart.subtotal)}</strong></div>
            </div>

            {preview ? (
              <div className={`checkoutReadiness ${preview.ready ? "checkoutReadinessReady" : "checkoutReadinessBlocked"}`}>
                <strong>{preview.ready ? "Ready for checkout" : "Checkout needs attention"}</strong>
                <p>{preview.ready ? `${preview.itemCount} unit(s) across ${preview.storeGroups.length} store shipment group(s) passed the current stock and availability preview.` : "Resolve the issues below before creating an order."}</p>
                {preview.issues.length > 0 ? <ul className="issueList">{preview.issues.map((issue) => <li key={`${issue.cartItemId}-${issue.code}`}>{issue.message}</li>)}</ul> : null}
              </div>
            ) : <p className="formMessage">Checkout readiness is temporarily unavailable. Your cart is still preserved.</p>}

            {preview?.ready ? (
              <Link className="primaryButton" href="/checkout">Continue to checkout</Link>
            ) : (
              <button className="primaryButton" type="button" disabled>Checkout unavailable</button>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
