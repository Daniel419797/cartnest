"use client";

import { useParams } from "next/navigation";
import { AuthGuard } from "../../../../components/auth-guard";
import { VendorStoreAnalytics } from "../../../../features/analytics/vendor-store-analytics";

export default function VendorAnalyticsPage() {
  const params = useParams<{ vendorId: string }>();
  return <AuthGuard><VendorStoreAnalytics vendorId={params.vendorId ?? ""} /></AuthGuard>;
}
