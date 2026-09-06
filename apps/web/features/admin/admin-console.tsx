"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { useSession } from "../../components/session-provider";
import { AdminCommercialPolicy } from "./admin-commercial-policy";
import { AdminNotificationOperations } from "./admin-notification-operations";
import { AdminOrderOperations } from "./admin-order-operations";
import { AdminOverview } from "./admin-overview";

type AdminSection = "overview" | "orders" | "commercial" | "notifications";

export function AdminConsole() {
  const { session, status, error, reloadSession } = useSession();
  const roleAllowed = Boolean(session && ["ADMIN", "SUPER_ADMIN"].includes(session.user.platformRole));
  const mfaSatisfied = Boolean(session?.mfa.satisfied);
  const [section, setSection] = useState<AdminSection>("overview");

  if (status === "loading") return <LoadingState label="Checking admin session…" />;
  if (status === "error") return <ErrorState title="Admin session unavailable" message={error ?? "CartNest could not verify your session."} action={<button className="secondaryButton" type="button" onClick={() => void reloadSession()}>Retry session</button>} />;
  if (!session || !roleAllowed) return <ErrorState title="Admin access required" message="This workspace is restricted to ADMIN and SUPER_ADMIN accounts." />;
  if (!mfaSatisfied) return <ErrorState title="Privileged MFA required" message="P10 administration changes and operational diagnostics require a currently MFA-satisfied admin session." action={<Link className="primaryButton" href="/mfa">Complete MFA</Link>} />;

  return (
    <main className="commercePage commerceStack">
      <div className="commerceHeader"><div className="commerceHeaderCopy"><p className="eyebrow">FP10 administration</p><h1 className="pageTitle">Marketplace operations console</h1><p>Analytics, commercial policy, order-state diagnostics, and notification operations share the same privileged server boundary.</p></div><Link className="secondaryButton" href="/admin/p9">Returns/refunds/reviews</Link></div>
      <nav className="actionRow" aria-label="Admin console sections">
        <button className={section === "overview" ? "primaryButton" : "secondaryButton"} type="button" onClick={() => setSection("overview")}>Overview</button>
        <button className={section === "orders" ? "primaryButton" : "secondaryButton"} type="button" onClick={() => setSection("orders")}>Order operations</button>
        <button className={section === "commercial" ? "primaryButton" : "secondaryButton"} type="button" onClick={() => setSection("commercial")}>Tax & promotions</button>
        <button className={section === "notifications" ? "primaryButton" : "secondaryButton"} type="button" onClick={() => setSection("notifications")}>Notifications</button>
      </nav>
      {section === "overview" ? <AdminOverview /> : null}
      {section === "orders" ? <AdminOrderOperations /> : null}
      {section === "commercial" ? <AdminCommercialPolicy /> : null}
      {section === "notifications" ? <AdminNotificationOperations /> : null}
    </main>
  );
}
