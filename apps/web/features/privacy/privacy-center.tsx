"use client";

import type { PrivacyRequestDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, privacyApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PrivacyCenter() {
  const [requests, setRequests] = useState<readonly PrivacyRequestDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<"export" | "erasure" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await privacyApi.listMine({ page: 1, pageSize: 20 });
      setRequests(response.items);
      setState("ready");
    } catch (caught) {
      setError(apiErrorMessage(caught, "CartNest could not load your privacy requests."));
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function exportData() {
    setBusy("export");
    setMessage(null);
    setError(null);
    try {
      const data = await privacyApi.exportMine();
      const date = data.generatedAt.slice(0, 10);
      downloadJson(`cartnest-personal-data-${date}.json`, data);
      setMessage("Your personal-data export was generated and downloaded to this device.");
    } catch (caught) {
      setError(apiErrorMessage(caught, "CartNest could not generate your personal-data export."));
    } finally {
      setBusy(null);
    }
  }

  async function requestErasure() {
    if (!confirmed) return;
    setBusy("erasure");
    setMessage(null);
    setError(null);
    try {
      const request = await privacyApi.requestErasure();
      setMessage(
        request.status === "REQUIRES_REVIEW"
          ? "Your erasure request was recorded and requires review because protected obligations remain."
          : "Your erasure request was recorded for administrator review.",
      );
      setConfirmed(false);
      await load();
    } catch (caught) {
      setError(apiErrorMessage(caught, "CartNest could not submit your erasure request."));
    } finally {
      setBusy(null);
    }
  }

  const activeRequest = requests.find((request) => ["PENDING", "REQUIRES_REVIEW"].includes(request.status));

  return (
    <section className="panel sellerForm" aria-labelledby="privacy-heading">
      <div className="sectionHeadingCompact">
        <div>
          <p className="eyebrow">Privacy & data rights</p>
          <h2 id="privacy-heading">Your CartNest data</h2>
          <p>Export the personal data CartNest holds for your account or submit an account-erasure request.</p>
        </div>
        <button className="secondaryButton" type="button" disabled={busy !== null} onClick={() => void exportData()}>
          {busy === "export" ? "Preparing export…" : "Download my data"}
        </button>
      </div>

      {state === "loading" ? <LoadingState label="Loading privacy requests…" /> : null}
      {state === "error" ? <ErrorState title="Privacy requests unavailable" message={error ?? "CartNest could not load your privacy state."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}

      {state === "ready" ? (
        <>
          <div className="sellerForm">
            <h3>Account erasure</h3>
            <p className="muted">
              Erasure is reviewed before anonymization. CartNest may retain pseudonymous commercial, financial, dispute, or audit records where integrity or approved retention rules require it. Active orders, returns, refunds, privileged roles, or vendor ownership can block anonymization until resolved.
            </p>
            {activeRequest ? (
              <p className="formMessage" role="status">An active request already exists. Current status: {orderStatusLabel(activeRequest.status)}.</p>
            ) : (
              <label className="field">
                <span><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand this request can lead to permanent account anonymization after review.</span>
              </label>
            )}
            <button className="dangerButton" type="button" disabled={busy !== null || Boolean(activeRequest) || !confirmed} onClick={() => void requestErasure()}>
              {busy === "erasure" ? "Submitting…" : activeRequest ? "Erasure request active" : "Request account erasure"}
            </button>
          </div>

          <div className="sellerForm">
            <div className="sectionHeadingCompact"><div><h3>Request history</h3><p>{requests.length} request{requests.length === 1 ? "" : "s"}</p></div><button className="secondaryButton compactButton" type="button" disabled={busy !== null} onClick={() => void load()}>Refresh</button></div>
            {requests.length === 0 ? <p className="muted">No erasure requests have been submitted.</p> : requests.map((request) => (
              <article className="orderItemRow" key={request.id}>
                <div>
                  <strong>{new Date(request.requestedAt).toLocaleString()}</strong>
                  <span>{request.reviewNote ?? "No review note."}</span>
                </div>
                <span className={orderStatusClass(request.status)}>{orderStatusLabel(request.status)}</span>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {message ? <p className="formMessage formMessageSuccess" role="status">{message}</p> : null}
      {error && state !== "error" ? <p className="formMessage formMessageError" role="alert">{error}</p> : null}
    </section>
  );
}
