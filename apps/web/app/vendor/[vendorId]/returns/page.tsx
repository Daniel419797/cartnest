"use client";

import { useParams } from "next/navigation";
import { AuthGuard } from "../../../../components/auth-guard";
import { VendorReturnsPage } from "../../../../features/returns/vendor-returns-page";

export default function VendorReturnsRoute() {
  const params = useParams<{ vendorId: string }>();
  return <AuthGuard><VendorReturnsPage vendorId={params.vendorId ?? ""} /></AuthGuard>;
}
