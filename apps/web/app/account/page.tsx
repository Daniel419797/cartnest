"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthGuard } from "../../components/auth-guard";
import { useSession } from "../../components/session-provider";
import { PrivacyCenter } from "../../features/privacy/privacy-center";
import { API_BASE_URL, api, apiErrorMessage } from "../../lib/api";

function AccountPanel() {
  const { session, reloadSession, logoutAll } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!session) return null;

  async function requestVerification(channel: "email" | "phone") {
    setBusy(channel); setMessage(null); setError(null);
    try {
      const result = await api.POST("/api/v1/auth/verification/request", { body: { channel } });
      if (!result.data) return setError(apiErrorMessage(result.error, "Verification request failed."));
      setMessage(`Verification requested for ${channel}. Use the token/link delivered through that channel.`);
    } catch {
      setError("CartNest could not reach the verification service.");
    } finally { setBusy(null); }
  }

  async function revokeEverywhere() {
    setBusy("logout-all"); setMessage(null); setError(null);
    const ok = await logoutAll();
    setBusy(null);
    if (ok) window.location.assign("/login");
    else setError("CartNest could not revoke every session. Try again before assuming other sessions are signed out.");
  }

  return (
    <section className="panel">
      <p className="eyebrow">Your account</p>
      <h1 className="pageTitle">Identity & security</h1>
      <p className="muted">Your CartNest identity can act as a customer and participate in vendor businesses according to server-authorized memberships and permissions.</p>
      <dl className="details">
        <div><dt>Email</dt><dd>{session.user.email ?? "Not added"} {session.user.email ? <span className={`statusPill ${session.user.emailVerified ? "statusPillGood" : ""}`}>{session.user.emailVerified ? "Verified" : "Unverified"}</span> : null}</dd></div>
        <div><dt>Phone</dt><dd>{session.user.phone ?? "Not added"} {session.user.phone ? <span className={`statusPill ${session.user.phoneVerified ? "statusPillGood" : ""}`}>{session.user.phoneVerified ? "Verified" : "Unverified"}</span> : null}</dd></div>
        <div><dt>Account status</dt><dd><span className="statusPill">{session.user.status}</span></dd></div>
        <div><dt>Platform role</dt><dd><span className="statusPill">{session.user.platformRole}</span></dd></div>
        <div><dt>MFA</dt><dd><span className={`statusPill ${session.mfa.satisfied ? "statusPillGood" : ""}`}>{session.mfa.required ? (session.mfa.satisfied ? "Required · verified" : session.mfa.enrolled ? "Required · challenge pending" : "Required · enrollment pending") : session.mfa.enrolled ? "Optional · enrolled" : "Optional"}</span></dd></div>
      </dl>
      <div className="actionRow">
        {session.user.email && !session.user.emailVerified ? <button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => void requestVerification("email")}>{busy === "email" ? "Requesting…" : "Verify email"}</button> : null}
        {session.user.phone && !session.user.phoneVerified ? <button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => void requestVerification("phone")}>{busy === "phone" ? "Requesting…" : "Verify phone"}</button> : null}
        <Link className="secondaryButton" href="/verify">Enter verification token</Link>
        <Link className="secondaryButton" href="/mfa">MFA settings</Link>
        <a className="secondaryButton" href={`${API_BASE_URL}/api/v1/auth/google/start?intent=link`}>Link Google</a>
        <button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => void reloadSession()}>Refresh account</button>
        <button className="dangerButton" type="button" disabled={busy !== null} onClick={() => void revokeEverywhere()}>{busy === "logout-all" ? "Revoking…" : "Sign out everywhere"}</button>
      </div>
      {message ? <p className="formMessage formMessageSuccess" role="status">{message}</p> : null}
      {error ? <p className="formMessage formMessageError" role="alert">{error}</p> : null}
    </section>
  );
}

export default function AccountPage() {
  return (
    <main className="pageShell">
      <AuthGuard>
        <div className="commerceStack">
          <AccountPanel />
          <PrivacyCenter />
        </div>
      </AuthGuard>
    </main>
  );
}
