"use client";

import type { WishlistItemDto, WishlistResponseDto } from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, cartApi, wishlistApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";

function wishlistVariantLabel(item: WishlistItemDto): string {
  if (!item.variant) return "Product saved without a specific variant";
  if (item.variant.optionValues.length === 0) return "Standard variant";
  return item.variant.optionValues.map((selection) => `${selection.optionName}: ${selection.value}`).join(" · ");
}

export function WishlistPageContent() {
  const [wishlist, setWishlist] = useState<WishlistResponseDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      setWishlist(await wishlistApi.get());
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load your wishlist."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(itemId: string) {
    setBusyItem(itemId);
    setMessage(null);
    try {
      setWishlist(await wishlistApi.removeItem(itemId));
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not remove this saved item."));
    } finally {
      setBusyItem(null);
    }
  }

  async function addToCart(item: WishlistItemDto) {
    if (!item.variant) return;
    setBusyItem(item.id);
    setMessage(null);
    try {
      await cartApi.addItem({ variantId: item.variant.id, quantity: 1 });
      setMessage(`${item.product.name} was added to your cart.`);
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not add this saved variant to your cart."));
    } finally {
      setBusyItem(null);
    }
  }

  if (state === "loading") return <main className="commercePage"><LoadingState label="Loading your wishlist…" /></main>;
  if (state === "error" || !wishlist) {
    return <main className="commercePage"><ErrorState title="Wishlist unavailable" message={message ?? "CartNest could not load your wishlist."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;
  }

  const hasItems = wishlist.items.length > 0 || wishlist.unavailableItems.length > 0;

  return (
    <main className="commercePage">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Saved for later</p>
          <h1 className="pageTitle">Wishlist</h1>
          <p className="muted">Save a product or a specific variant and return to it without turning the wishlist into a second cart.</p>
        </div>
        <Link className="secondaryButton" href="/marketplace">Browse marketplace</Link>
      </div>

      {message ? <p className="formMessage" role="status">{message}</p> : null}

      {!hasItems ? (
        <EmptyState title="Nothing saved yet" message="Open a product and save the variant you want to revisit." action={<Link className="primaryButton" href="/marketplace">Find products</Link>} />
      ) : (
        <div className="commerceStack">
          {wishlist.items.length > 0 ? (
            <section className="wishlistGrid" aria-label="Available wishlist items">
              {wishlist.items.map((item) => {
                const image = item.product.media[0];
                return (
                  <article className="wishlistCard" key={item.id}>
                    <div className="wishlistImage">
                      {image ? <img src={image.url} alt={image.altText ?? item.product.name} loading="lazy" decoding="async" fetchPriority="low" /> : <span className="commerceImageFallback">CN</span>}
                    </div>
                    <div className="wishlistBody">
                      <div>
                        <p className="eyebrow">{item.product.store.name}</p>
                        <h2><Link href={`/products/${encodeURIComponent(item.product.id)}`}>{item.product.name}</Link></h2>
                        <p className="variantLabel">{wishlistVariantLabel(item)}</p>
                      </div>
                      <div className="wishlistFooter">
                        <strong>{item.variant ? formatMoney(item.variant.price) : formatMoney(item.product.priceFrom)}</strong>
                        <span className="commerceMeta">{item.product.store.vendorDisplayName}</span>
                      </div>
                      <div className="wishlistActions">
                        {item.variant ? (
                          <button className="primaryButton compactButton" type="button" disabled={busyItem === item.id} onClick={() => void addToCart(item)}>
                            Add to cart
                          </button>
                        ) : (
                          <Link className="primaryButton compactButton" href={`/products/${encodeURIComponent(item.product.id)}`}>Choose variant</Link>
                        )}
                        <button className="secondaryButton compactButton" type="button" disabled={busyItem === item.id} onClick={() => void remove(item.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}

          {wishlist.unavailableItems.length > 0 ? (
            <section className="unavailableSection">
              <div>
                <h2>Unavailable saved items</h2>
                <p className="variantLabel">CartNest keeps these records visible so you can remove products or variants that were unpublished, archived, or otherwise became unavailable.</p>
              </div>
              {wishlist.unavailableItems.map((item) => (
                <article className="unavailableCard" key={item.id}>
                  <div>
                    <strong>Saved item unavailable</strong>
                    <p>Product {item.productId.slice(0, 8)}{item.variantId ? ` · variant ${item.variantId.slice(0, 8)}` : ""}</p>
                  </div>
                  <button className="dangerButton compactButton" type="button" disabled={busyItem === item.id} onClick={() => void remove(item.id)}>
                    Remove saved item
                  </button>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
