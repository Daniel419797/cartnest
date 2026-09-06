"use client";

import type { VendorAccessDto, VendorPermissionDto } from "@repo/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { hasVendorPermission } from "./permissions";

interface WorkspaceLink {
  readonly label: string;
  readonly href: string;
  readonly permission?: VendorPermissionDto;
  readonly permissions?: readonly VendorPermissionDto[];
  readonly ownerOrPermission?: VendorPermissionDto;
}

function statusClass(status: string): string {
  if (status === "APPROVED" || status === "ACTIVE" || status === "VERIFIED") return "statusPill statusPillGood";
  if (status === "REJECTED" || status === "SUSPENDED" || status === "CLOSED") return "statusPill statusPillDanger";
  return "statusPill statusPillWarning";
}

export function VendorWorkspaceShell({
  access,
  children,
}: Readonly<{
  access: VendorAccessDto;
  children: ReactNode;
}>) {
  const pathname = usePathname();
  const vendorId = encodeURIComponent(access.vendor.id);
  const root = `/vendor/${vendorId}`;
  const links: readonly WorkspaceLink[] = [
    { label: "Overview", href: root },
    { label: "Stores", href: `${root}/stores`, permission: "store:read" },
    { label: "Products", href: `${root}/products`, permissions: ["store:read", "product:read"] },
    { label: "Inventory", href: `${root}/inventory`, permission: "inventory:read" },
    { label: "Orders", href: `${root}/orders`, permission: "order:read" },
    { label: "Returns", href: `${root}/returns`, permission: "order:read" },
    { label: "Analytics", href: `${root}/analytics`, permission: "analytics:read" },
    { label: "Verification", href: `${root}/kyc`, ownerOrPermission: "verification:manage" },
    { label: "Staff & permissions", href: `${root}/staff`, permission: "staff:read" },
  ];

  const visibleLinks = links.filter((link) => {
    if (!link.permission && !link.permissions && !link.ownerOrPermission) return true;
    if (link.permission) return hasVendorPermission(access, link.permission);
    if (link.permissions) return link.permissions.every((permission) => hasVendorPermission(access, permission));
    return access.membership.status === "ACTIVE" &&
      (access.membership.role === "OWNER" || hasVendorPermission(access, link.ownerOrPermission!));
  });

  return (
    <div className="vendorWorkspace">
      <aside className="vendorSidebar" aria-label="Vendor workspace navigation">
        <div className="vendorIdentity">
          <Link className="vendorBackLink" href="/vendor">← Seller home</Link>
          <h2>{access.vendor.displayName}</h2>
          <div className="vendorBadgeRow">
            <span className={statusClass(access.vendor.status)}>{access.vendor.status}</span>
            <span className="statusPill">{access.membership.role}</span>
          </div>
        </div>
        <nav className="vendorNav">
          {visibleLinks.map((link) => {
            const active = link.href === root ? pathname === root : pathname.startsWith(link.href);
            return (
              <Link key={link.href} className="vendorNavLink" aria-current={active ? "page" : undefined} href={link.href}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="vendorContent">{children}</section>
    </div>
  );
}

export function VendorStatusPill({ status }: Readonly<{ status: string }>) {
  return <span className={statusClass(status)}>{status.replaceAll("_", " ")}</span>;
}
