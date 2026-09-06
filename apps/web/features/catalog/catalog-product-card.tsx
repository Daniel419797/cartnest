import type { CatalogProductSummaryDto } from "@repo/contracts";
import Link from "next/link";
import { formatMoney, shortDescription } from "./catalog-utils";

export function CatalogProductCard({ product }: Readonly<{ product: CatalogProductSummaryDto }>) {
  const primaryImage = product.media[0];

  return (
    <article className="catalogCard">
      <Link className="catalogCardImage" href={`/products/${encodeURIComponent(product.id)}`} aria-label={`View ${product.name}`}>
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt={primaryImage.altText ?? product.name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
          />
        ) : (
          <span className="catalogImageFallback" aria-hidden="true">CN</span>
        )}
      </Link>
      <div className="catalogCardBody">
        <div className="catalogCardMeta">
          <span>{product.category?.name ?? "Uncategorized"}</span>
          <span>{product.store.name}</span>
        </div>
        <h2><Link href={`/products/${encodeURIComponent(product.id)}`}>{product.name}</Link></h2>
        <p>{shortDescription(product.description)}</p>
        <div className="catalogCardFooter">
          <strong>{formatMoney(product.priceFrom)}</strong>
          <span>{product.store.vendorDisplayName}</span>
        </div>
      </div>
    </article>
  );
}
