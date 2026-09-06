"use client";

import type { AdminPrivacyRequestDto, PrivacyRequestStatusDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, privacyApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const STATUSES: readonly PrivacyRequestStatusDto[] = ["PENDING", "REQUIRES_REVIEW", "COMPLETED", "REJECTED"];

export function AdminPrivacyOperations() {
  const [items, setItems] = useState<readonly AdminPrivacyRequestDto[]>([]);
  const [status, setStatus] = useState<"" | PrivacyRequestStatusDto>("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await privacyApi.listAdmin({ page: 1, pageSize: 100, ...(status ? { status } : {}) });
      setItems(response.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load the privacy review queue."));
      setState("error");
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function process(request: AdminPrivacyRequestDto, decision: "ANONYMIZE" | "REJECT") {
    const reason = (reasons[request.id] ?? "").trim();
    if (reason.length < 10) {
      setMessage("Enter a review reason of at least 10 characters before recording a privacy decision.");
      return;
    }
    if (decision === "ANONYMIZE") {
      const confirmed = window.confirm(
        `Permanently anonymize account ${request.subjectUserId}? This action revokes authentication data and redacts eligible personal data.`,
      );
      if (!confirmed) return;
    }

    setBusyId(request.id);
    setMessage(null);
    try {
      await privacyApi.processAdminRequest(request.id, { decision, reason });
      setReasons((current) => ({ ...current, [request.id]: "" }));
      await load();
    } catch (caught) {
      const failure = apiErrorMessage(caught, "CartNest could not process this privacy request.");
      await load().catch(() => undefined);
      setMessage(failure);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="commerceStack" aria-labelledby="privacy-ops-heading">
      <div className="sectionHeadingCompact">
        <div>
          <h2 id="privacy-ops-heading">Privacy & erasure operations</h2>
          <p>Review data-subject erasure requests under the privileged MFA boundary. The server re-checks business and fulfillment blockers before anonymization.</p>
        </div>
        <button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>Refresh</button>
      </div>

      <div className="panel compactPanel">
        <label className="field">Status
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | PrivacyRequestStatusDto)}>
            <option value="">All</option>
            {STATUSES.map((item) => <option key={item} value={item}>{orderStatusLabel(item)}</option>)}
          </select>
        </label>
      </div>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {state === "loading" ? <LoadingState label="Loading privacy requests…" /> : null}
      {state === "error" ? <ErrorState title="Privacy queue unavailable" message={message ?? "CartNest could not load privacy requests."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}

      {state === "ready" && items.length === 0 ? <div className="panel"><p className="muted">No privacy requests match this filter.</p></div> : null}
      {state === "ready" ? items.map((request) => {
        const final = request.status === "COMPLETED" || request.status === "REJECTED";
        return (
          <article className="panel sellerForm" key={request.id}>
            <div className="sectionHeadingCompact">
              <div>
                <p className="eyebrow">Subject {request.subjectUserId}</p>
                <h3>Erasure request {request.id.slice(0, 8).toUpperCase()}</h3>
                <p>Requested {new Date(request.requestedAt).toLocaleString()}</p>
              </div>
              <span className={orderStatusClass(request.status)}>{orderStatusLabel(request.status)}</span>
            </div>
            {request.reviewNote ? <p className="formMessage">{request.reviewNote}</p> : null}
            {request.processedAt ? <p className="fieldHint">Processed {new Date(request.processedAt).toLocaleString()}</p> : null}
            {!final ? (
              <>
                <label className="field">Review reason
                  <textarea
                    rows={3}
                    minLength={10}
                    maxLength={1000}
                    value={reasons[request.id] ?? ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                    placeholder="Record the legal/operational basis for this decision."
                  />
                </label>
                <div className="actionRow">
                  <button className="dangerButton" type="button" disabled={busyId !== null} onClick={() => void process(request, "ANONYMIZE")}>
                    {busyId === request.id ? "Processing…" : "Approve anonymization"}
                  </button>
                  <button className="secondaryButton" type="button" disabled={busyId !== null} onClick={() => void process(request, "REJECT")}>
                    Reject request
                  </button>
                </div>
              </>
            ) : null}
          </article>
        );
      }) : null}
    </section>
  );
}
