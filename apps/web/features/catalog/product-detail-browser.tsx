"use client";

import type { CatalogProductDetailResponseDto } from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { useSession } from "../../components/session-provider";
import { apiErrorMessage, cartApi, catalogApi, wishlistApi } from "../../lib/api";
import { PublicReviews } from "../returns/public-reviews";
import {
  bestVariantForOptionValue,
  formatMoney,
  variantMatchesSelection,
  variantSelection,
} from "./catalog-utils";

function initialSelection(product: CatalogProductDetailResponseDto): Record<string, string> {
  const firstVariant = product.variants[0];
  return firstVariant ? variantSelection(firstVariant) : {};
}

export function ProductDetailBrowser({ productId }: Readonly<{ productId: string }>) {
  const { session, status: sessionStatus, reloadSession } = useSession();
  const [product, setProduct] = useState<CatalogProductDetailResponseDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState("1");
  const [commerceBusy, setCommerceBusy] = useState<"cart" | "wishlist" | null>(null);
  const [commerceMessage, setCommerceMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const next = await catalogApi.getCatalogProduct(productId);
      setProduct(next);
      setSelected(initialSelection(next));
      setActiveImage(0);
      setQuantity("1");
      setCommerceMessage(null);
      setState("ready");
    } catch (caught) {
      setError(apiErrorMessage(caught, "CartNest could not load this product."));
      setState("error");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedVariant = useMemo(() => {
    if (!product) return null;
    return product.variants.find((variant) => variantMatchesSelection(variant, selected)) ?? null;
  }, [product, selected]);

  async function addToCart() {
    if (!selectedVariant || !session) return;
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 1000) {
      setCommerceMessage("Quantity must be a whole number between 1 and 1000.");
      return;
    }
    setCommerceBusy("cart");
    setCommerceMessage(null);
    try {
      await cartApi.addItem({ variantId: selectedVariant.id, quantity: parsedQuantity });
      setCommerceMessage(`${parsedQuantity} × ${product?.name ?? "product"} added to your cart.`);
    } catch (caught) {
      setCommerceMessage(apiErrorMessage(caught, "CartNest could not add this variant to your cart."));
    } finally {
      setCommerceBusy(null);
    }
  }

  async function saveToWishlist() {
    if (!selectedVariant || !session || !product) return;
    setCommerceBusy("wishlist");
    setCommerceMessage(null);
    try {
      await wishlistApi.addItem({ productId: product.id, variantId: selectedVariant.id });
      setCommerceMessage("This variant is saved to your wishlist.");
    } catch (caught) {
      setCommerceMessage(apiErrorMessage(caught, "CartNest could not save this variant."));
    } finally {
      setCommerceBusy(null);
    }
  }

  if (state === "loading") return <main className="pageShell"><LoadingState label="Loading product…" /></main>;
  if (state === "error" || !product) {
    return <main className="pageShell"><ErrorState title="Product unavailable" message={error ?? "This product could not be loaded."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /></main>;
  }

  const image = product.media[activeImage] ?? product.media[0];
  const returnTo = `/products/${encodeURIComponent(productId)}`;

  return (
    <main className="productDetailPage commerceStack">
      <div className="productBreadcrumbs">
        <Link href="/marketplace">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span>{product.category?.name ?? "Product"}</span>
      </div>

      <section className="productDetailGrid">
        <div className="productGallery">
          <div className="productHeroImage">
            {image ? <img src={image.url} alt={image.altText ?? product.name} decoding="async" fetchPriority="high" /> : <span className="catalogImageFallback">CN</span>}
          </div>
          {product.media.length > 1 ? (
            <div className="productThumbs" aria-label="Product images">
              {product.media.map((media, index) => (
                <button key={media.id} type="button" className={index === activeImage ? "productThumb productThumbActive" : "productThumb"} aria-label={`View image ${index + 1}`} aria-pressed={index === activeImage} onClick={() => setActiveImage(index)}>
                  <img src={media.url} alt="" loading="lazy" decoding="async" fetchPriority="low" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="productInfoPanel">
          <div className="productInfoTopline"><span className="statusPill">{product.category?.name ?? "Uncategorized"}</span><span>{product.store.vendorDisplayName}</span></div>
          <h1 className="pageTitle">{product.name}</h1>
          <p className="productStoreLine">Sold by <strong>{product.store.name}</strong></p>
          <div className="productPrice">{selectedVariant ? formatMoney(selectedVariant.price) : formatMoney(product.priceFrom)}</div>
          <p className="productDescription">{product.description}</p>

          {product.options.length > 0 ? (
            <div className="optionSelectors">
              {product.options.map((option) => (
                <fieldset className="optionSelector" key={option.id}>
                  <legend>{option.name}</legend>
                  <div className="optionValueRow">
                    {option.values.map((value) => {
                      const active = selected[option.id] === value.id;
                      const compatibleVariant = bestVariantForOptionValue(product.variants, option.id, value.id, selected);
                      return <button key={value.id} type="button" className={active ? "optionValue optionValueActive" : "optionValue"} disabled={!compatibleVariant} aria-pressed={active} onClick={() => { if (compatibleVariant) { setSelected(variantSelection(compatibleVariant)); setCommerceMessage(null); } }}>{value.value}</button>;
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}

          {selectedVariant ? (
            <div className="variantSummary"><div><span>SKU</span><strong>{selectedVariant.sku}</strong></div><div><span>Variant</span><strong>{selectedVariant.optionValues.length > 0 ? selectedVariant.optionValues.map((item) => item.value).join(" / ") : "Standard"}</strong></div></div>
          ) : <p className="formMessage formMessageError" role="status">This option combination is not currently available. Choose another value.</p>}

          <div className="productCommerceActions">
            {sessionStatus === "authenticated" && session ? (
              <>
                <div className="productCommerceControls">
                  <label className="field productQuantity">Quantity<input type="number" min={1} max={1000} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={!selectedVariant || commerceBusy !== null} /></label>
                  <button className="primaryButton" type="button" disabled={!selectedVariant || commerceBusy !== null} onClick={() => void addToCart()}>{commerceBusy === "cart" ? "Adding…" : "Add to cart"}</button>
                  <button className="secondaryButton" type="button" disabled={!selectedVariant || commerceBusy !== null} onClick={() => void saveToWishlist()}>{commerceBusy === "wishlist" ? "Saving…" : "Save variant"}</button>
                </div>
                {commerceMessage ? <p className="formMessage" role="status">{commerceMessage}</p> : null}
              </>
            ) : sessionStatus === "loading" ? <p className="formMessage">Checking your account before enabling cart and wishlist actions…</p> : sessionStatus === "unauthenticated" ? (
              <div className="actionRow"><Link className="primaryButton" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in to add to cart</Link><Link className="secondaryButton" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in to save</Link></div>
            ) : (
              <div className="actionRow"><p className="formMessage formMessageError">CartNest could not verify your session, so cart and wishlist mutations are disabled until the session check succeeds.</p><button className="secondaryButton" type="button" onClick={() => void reloadSession()}>Retry session check</button></div>
            )}
          </div>

          <div className="productPhaseNotice"><strong>Secure marketplace listing</strong><span>CartNest only exposes products from active stores, approved vendors, accepted moderation states and active variants. Cart pricing and stock are revalidated by the backend.</span></div>
        </div>
      </section>

      <PublicReviews productId={product.id} storeId={product.store.id} />
    </main>
  );
}
