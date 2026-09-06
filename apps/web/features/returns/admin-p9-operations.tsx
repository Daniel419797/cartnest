"use client";

import type {
  RefundDto,
  ReviewDto,
  ReviewModerationBodyDto,
  ReviewStatusDto,
} from "@repo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { useSession } from "../../components/session-provider";
import { apiErrorMessage, returnsApi } from "../../lib/api";
import { formatMoney } from "../catalog/catalog-utils";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const REVIEW_STATUSES: readonly ReviewStatusDto[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REMOVED",
];

function reviewKey(review: ReviewDto): string {
  return `${review.targetType}:${review.id}`;
}

export function AdminP9Operations() {
  const { session, status: sessionStatus, error: sessionError, reloadSession } = useSession();
  const [refunds, setRefunds] = useState<readonly RefundDto[]>([]);
  const [reviews, setReviews] = useState<readonly ReviewDto[]>([]);
  const [reviewStatus, setReviewStatus] = useState<"" | ReviewStatusDto>("PENDING");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const roleAllowed = Boolean(
    session && ["ADMIN", "SUPER_ADMIN"].includes(session.user.platformRole),
  );
  const mfaSatisfied = Boolean(session?.mfa.satisfied);

  const load = useCallback(async () => {
    if (!roleAllowed || !mfaSatisfied) return;
    setState("loading");
    setMessage(null);
    try {
      const [refundResponse, reviewResponse] = await Promise.all([
        returnsApi.listAdminRefunds({ pageSize: 100 }),
        returnsApi.listAdminReviews({
          ...(reviewStatus ? { status: reviewStatus } : {}),
          pageSize: 100,
        }),
      ]);
      setRefunds(refundResponse.items);
      setReviews(reviewResponse.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load FP9 admin operations."));
      setState("error");
    }
  }, [mfaSatisfied, reviewStatus, roleAllowed]);

  useEffect(() => { void load(); }, [load]);

  async function refundAction(refund: RefundDto, action: "approve" | "reconcile") {
    if (!roleAllowed || !mfaSatisfied) return;
    const key = `refund:${refund.id}`;
    setBusyKey(key);
    setMessage(null);
    try {
      if (action === "approve") await returnsApi.approveRefund(refund.id);
      else await returnsApi.reconcileRefund(refund.id);
      await load();
    } catch (caught) {
      setMessage(
        apiErrorMessage(
          caught,
          action === "approve"
            ? "CartNest could not execute this refund."
            : "CartNest could not reconcile this refund.",
        ),
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function moderate(review: ReviewDto, status: ReviewModerationBodyDto["status"]) {
    if (!roleAllowed || !mfaSatisfied) return;
    const key = reviewKey(review);
    setBusyKey(key);
    setMessage(null);
    try {
      const reason = reasons[key]?.trim();
      await returnsApi.moderateReview(review.id, {
        status,
        ...(reason ? { reason } : {}),
      });
      setReasons((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not moderate this review."));
    } finally {
      setBusyKey(null);
    }
  }

  if (sessionStatus === "loading") return <LoadingState label="Checking admin session…" />;
  if (sessionStatus === "error") {
    return (
      <ErrorState
        title="Admin session unavailable"
        message={sessionError ?? "CartNest could not verify your session."}
        action={<button className="secondaryButton" type="button" onClick={() => void reloadSession()}>Retry session</button>}
      />
    );
  }
  if (!session || !roleAllowed) {
    return <ErrorState title="Admin access required" message="This workspace is restricted to ADMIN and SUPER_ADMIN accounts." />;
  }
  if (!mfaSatisfied) {
    return (
      <ErrorState
        title="Privileged MFA required"
        message="Refund execution and review moderation require a currently MFA-satisfied admin session."
        action={<Link className="primaryButton" href="/mfa">Complete MFA</Link>}
      />
    );
  }

  return (
    <main className="commercePage commerceStack">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">FP9 admin</p>
          <h1 className="pageTitle">Refunds & review moderation</h1>
          <p>Economic refund actions and moderation are protected by role checks and privileged MFA on both UI and API boundaries.</p>
        </div>
        <button className="secondaryButton" type="button" onClick={() => void load()} disabled={state === "loading"}>
          {state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {state === "loading" ? <LoadingState label="Loading FP9 queues…" /> : null}
      {state === "error" ? (
        <ErrorState
          title="Admin queues unavailable"
          message={message ?? "CartNest could not load admin queues."}
          action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>}
        />
      ) : null}

      {state === "ready" ? (
        <>
          <section className="commerceStack" aria-labelledby="refund-admin-heading">
            <div className="sectionHeadingCompact">
              <div>
                <h2 id="refund-admin-heading">Refund queue</h2>
                <p>Provider execution is claimed atomically before any external refund call. PROCESSING refunds must be reconciled rather than blindly retried.</p>
              </div>
              <span className="statusPill">{refunds.length}</span>
            </div>

            {refunds.length === 0 ? (
              <div className="panel"><p>No refunds are currently recorded.</p></div>
            ) : refunds.map((refund) => {
              const key = `refund:${refund.id}`;
              return (
                <article className="panel sellerForm" key={refund.id}>
                  <div className="sectionHeadingCompact">
                    <div>
                      <p className="eyebrow">Refund {refund.id.slice(0, 8).toUpperCase()}</p>
                      <h3>{formatMoney(refund.amount)}</h3>
                      <p>{refund.reason} · {refund.provider}</p>
                    </div>
                    <span className={orderStatusClass(refund.status)}>{orderStatusLabel(refund.status)}</span>
                  </div>
                  <div className="orderMetadata">
                    <span>Created {new Date(refund.createdAt).toLocaleString()}</span>
                    {refund.providerRefundReference ? <span>Provider ref {refund.providerRefundReference}</span> : null}
                    {refund.returnRequestId ? <span>Return {refund.returnRequestId.slice(0, 8).toUpperCase()}</span> : null}
                  </div>
                  <div className="actionRow">
                    {["REQUESTED", "APPROVED"].includes(refund.status) ? (
                      <button className="dangerButton" type="button" disabled={busyKey !== null} onClick={() => void refundAction(refund, "approve")}>
                        {busyKey === key ? "Executing…" : "Approve & execute"}
                      </button>
                    ) : null}
                    {refund.status === "PROCESSING" ? (
                      <button className="secondaryButton" type="button" disabled={busyKey !== null || !refund.providerRefundReference} onClick={() => void refundAction(refund, "reconcile")}>
                        {busyKey === key ? "Reconciling…" : "Reconcile provider state"}
                      </button>
                    ) : null}
                  </div>
                  {refund.status === "PROCESSING" && !refund.providerRefundReference ? (
                    <p className="fieldHint">Provider outcome is ambiguous and no reference is available. Do not issue another economic refund; investigate through the provider account.</p>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section className="commerceStack" aria-labelledby="review-admin-heading">
            <div className="sectionHeadingCompact">
              <div>
                <h2 id="review-admin-heading">Review moderation</h2>
                <p>Use the status filter to revisit approved content for later removal or restore rejected content after review.</p>
              </div>
              <span className="statusPill">{reviews.length}</span>
            </div>

            <div className="panel compactPanel">
              <label className="field">Review status
                <select value={reviewStatus} disabled={state === "loading" || busyKey !== null} onChange={(event) => setReviewStatus(event.target.value as "" | ReviewStatusDto)}>
                  <option value="">All statuses</option>
                  {REVIEW_STATUSES.map((status) => <option key={status} value={status}>{orderStatusLabel(status)}</option>)}
                </select>
              </label>
            </div>

            {reviews.length === 0 ? (
              <div className="panel"><p>No reviews match the selected moderation status.</p></div>
            ) : reviews.map((review) => {
              const key = reviewKey(review);
              return (
                <article className="panel sellerForm" key={key}>
                  <div className="sectionHeadingCompact">
                    <div>
                      <p className="eyebrow">{orderStatusLabel(review.targetType)} review</p>
                      <h3>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</h3>
                      <p>{review.text ?? "Rating only"}</p>
                    </div>
                    <span className={orderStatusClass(review.status)}>{orderStatusLabel(review.status)}</span>
                  </div>
                  <label className="field">Moderation reason <span className="fieldHint">Optional, stored in audit evidence</span>
                    <input minLength={2} maxLength={1000} value={reasons[key] ?? ""} disabled={busyKey !== null} onChange={(event) => setReasons((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                  <div className="actionRow">
                    {review.status !== "APPROVED" ? <button className="primaryButton" type="button" disabled={busyKey !== null} onClick={() => void moderate(review, "APPROVED")}>{busyKey === key ? "Working…" : "Approve"}</button> : null}
                    {review.status !== "REJECTED" ? <button className="dangerButton" type="button" disabled={busyKey !== null} onClick={() => void moderate(review, "REJECTED")}>Reject</button> : null}
                    {review.status !== "REMOVED" ? <button className="secondaryButton" type="button" disabled={busyKey !== null} onClick={() => void moderate(review, "REMOVED")}>Remove</button> : null}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      ) : null}
    </main>
  );
}
