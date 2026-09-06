"use client";

import type { NotificationChannelDto, NotificationStatusDto, OperationalNotificationDto } from "@repo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, notificationsApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const NOTIFICATION_STATUSES: readonly NotificationStatusDto[] = ["PENDING", "QUEUED", "SENT", "DELIVERED", "FAILED", "CANCELLED"];
const NOTIFICATION_CHANNELS: readonly NotificationChannelDto[] = ["EMAIL", "SMS", "IN_APP"];

export function AdminNotificationOperations() {
  const [items, setItems] = useState<readonly OperationalNotificationDto[]>([]);
  const [status, setStatus] = useState<"" | NotificationStatusDto>("");
  const [channel, setChannel] = useState<"" | NotificationChannelDto>("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const response = await notificationsApi.listOperational({ page: 1, pageSize: 100, ...(status ? { status } : {}), ...(channel ? { channel } : {}) });
      setItems(response.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load notification operations."));
      setState("error");
    }
  }, [channel, status]);

  useEffect(() => { void load(); }, [load]);

  async function retry(item: OperationalNotificationDto) {
    if (item.channel === "IN_APP" || !["FAILED", "QUEUED"].includes(item.status)) return;
    setBusyId(item.id);
    setMessage(null);
    try {
      await notificationsApi.retryOperational(item.id);
      await load();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not queue this notification retry."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="commerceStack" aria-labelledby="notification-ops-heading">
      <div className="sectionHeadingCompact"><div><h2 id="notification-ops-heading">Notification operations</h2><p>Inspect provider-neutral delivery state and requeue only eligible external-channel notices.</p></div><button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>Refresh</button></div>
      <div className="panel compactPanel"><div className="formGrid formGridTwo"><label className="field">Status<select value={status} onChange={(event) => setStatus(event.target.value as "" | NotificationStatusDto)}><option value="">All</option>{NOTIFICATION_STATUSES.map((item) => <option key={item} value={item}>{orderStatusLabel(item)}</option>)}</select></label><label className="field">Channel<select value={channel} onChange={(event) => setChannel(event.target.value as "" | NotificationChannelDto)}><option value="">All</option>{NOTIFICATION_CHANNELS.map((item) => <option key={item} value={item}>{orderStatusLabel(item)}</option>)}</select></label></div></div>
      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}
      {state === "loading" ? <LoadingState label="Loading notification queue…" /> : null}
      {state === "error" ? <ErrorState title="Notification operations unavailable" message={message ?? "CartNest could not load provider queue state."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}
      {state === "ready" ? items.map((item) => <article className="panel sellerForm" key={item.id}><div className="sectionHeadingCompact"><div><p className="eyebrow">{orderStatusLabel(item.channel)} · {item.templateKey}</p><h3>{item.recipient}</h3><p>{item.provider ?? "provider not assigned"}{item.providerRef ? ` · ${item.providerRef}` : ""}</p></div><span className={orderStatusClass(item.status)}>{orderStatusLabel(item.status)}</span></div><div className="orderMetadata"><span>Attempts {item.attempts}</span><span>Updated {new Date(item.updatedAt).toLocaleString()}</span>{item.nextAttemptAt ? <span>Next attempt {new Date(item.nextAttemptAt).toLocaleString()}</span> : null}</div>{item.lastError ? <p className="formMessage formMessageError">{item.lastError}</p> : null}{item.channel !== "IN_APP" && ["FAILED", "QUEUED"].includes(item.status) ? <div className="actionRow"><button className="secondaryButton" type="button" disabled={busyId !== null} onClick={() => void retry(item)}>{busyId === item.id ? "Requeueing…" : "Queue retry"}</button></div> : null}</article>) : null}
    </section>
  );
}
