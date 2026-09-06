"use client";

import type { ReviewDto } from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiErrorMessage, returnsApi } from "../../lib/api";

function ReviewGroup({
  title,
  reviews,
  error,
}: Readonly<{
  title: string;
  reviews: readonly ReviewDto[];
  error: string | null;
}>) {
  const average = useMemo(() => reviews.length > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0, [reviews]);
  return (
    <section className="panel sellerForm">
      <div className="sectionHeadingCompact">
        <div><h2>{title}</h2><p>{reviews.length > 0 ? `${average.toFixed(1)} / 5 from ${reviews.length} approved review(s)` : "No approved reviews yet."}</p></div>
        {reviews.length > 0 ? <span className="statusPill statusPillGood">★ {average.toFixed(1)}</span> : null}
      </div>
      {error ? <p className="formMessage formMessageError" role="alert">{error}</p> : null}
      <div className="commerceStack">
        {reviews.map((review) => (
          <article className="orderItemRow" key={review.id}>
            <div><strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</strong><span>{review.text ?? "Verified purchase rating"}</span><span>{new Date(review.createdAt).toLocaleDateString()}</span></div>
            <span className="statusPill">Verified purchase</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PublicReviews({ productId, storeId }: Readonly<{ productId: string; storeId: string }>) {
  const [productReviews, setProductReviews] = useState<readonly ReviewDto[]>([]);
  const [storeReviews, setStoreReviews] = useState<readonly ReviewDto[]>([]);
  const [productError, setProductError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setProductError(null);
    setStoreError(null);
    const [productResult, storeResult] = await Promise.allSettled([
      returnsApi.listProductReviews(productId, { pageSize: 50 }),
      returnsApi.listStoreReviews(storeId, { pageSize: 50 }),
    ]);
    if (productResult.status === "fulfilled") setProductReviews(productResult.value.items);
    else setProductError(apiErrorMessage(productResult.reason, "Product reviews are temporarily unavailable."));
    if (storeResult.status === "fulfilled") setStoreReviews(storeResult.value.items);
    else setStoreError(apiErrorMessage(storeResult.reason, "Store reviews are temporarily unavailable."));
    setLoading(false);
  }, [productId, storeId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="commerceStack" aria-label="Verified purchase reviews">
      <div className="sectionHeadingCompact"><div><p className="eyebrow">Verified reviews</p><h2>What buyers say</h2><p>Only approved reviews from delivered purchases are shown publicly.</p></div><button className="secondaryButton" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh reviews"}</button></div>
      <div className="formGrid formGridTwo">
        <ReviewGroup title="Product reviews" reviews={productReviews} error={productError} />
        <ReviewGroup title="Store reviews" reviews={storeReviews} error={storeError} />
      </div>
    </section>
  );
}
