"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./session-provider";

export function AppHeader() {
  const pathname = usePathname();
  const { session, status, logout, reloadSession } = useSession();
  const marketplaceActive = pathname.startsWith("/marketplace") || pathname.startsWith("/products/");
  const cartActive = pathname.startsWith("/cart") || pathname.startsWith("/checkout");
  const admin = Boolean(session && ["ADMIN", "SUPER_ADMIN"].includes(session.user.platformRole));

  return (
    <header className="siteHeader">
      <div className="headerInner">
        <Link className="brand" href="/" aria-label="CartNest home">
          <span className="brandMark" aria-hidden="true">C</span>
          <span>CartNest</span>
        </Link>

        <nav className="primaryNav" aria-label="Primary navigation">
          <Link className="navLink" aria-current={marketplaceActive ? "page" : undefined} href="/marketplace">Marketplace</Link>
          {status === "authenticated" ? (
            <>
              <Link className="navLink commerceNavLink" aria-current={pathname.startsWith("/wishlist") ? "page" : undefined} href="/wishlist">Saved</Link>
              <Link className="navLink commerceNavLink" aria-current={cartActive ? "page" : undefined} href="/cart">Cart</Link>
              <Link className="navLink commerceNavLink" aria-current={pathname.startsWith("/orders") ? "page" : undefined} href="/orders">Orders</Link>
              <Link className="navLink commerceNavLink" aria-current={pathname.startsWith("/returns") ? "page" : undefined} href="/returns">Returns</Link>
              <Link className="navLink" aria-current={pathname.startsWith("/vendor") ? "page" : undefined} href="/vendor">Seller</Link>
              {admin ? <Link className="navLink" aria-current={pathname.startsWith("/admin") ? "page" : undefined} href="/admin/p9">Admin</Link> : null}
              <Link className="navLink" aria-current={pathname.startsWith("/account") ? "page" : undefined} href="/account">Account</Link>
              {session?.mfa.required && !session.mfa.satisfied ? <Link className="navLink navLinkAlert" href="/mfa">Verify MFA</Link> : null}
              <button className="navButton" type="button" onClick={() => void logout()}>Sign out</button>
            </>
          ) : status === "unauthenticated" ? (
            <><Link className="navLink" href="/login">Sign in</Link><Link className="headerCta" href="/register">Create account</Link></>
          ) : status === "loading" ? <span className="navStatus" aria-live="polite">Checking session…</span> : (
            <button className="navButton navLinkAlert" type="button" onClick={() => void reloadSession()}>Retry session</button>
          )}
        </nav>
      </div>
    </header>
  );
}
