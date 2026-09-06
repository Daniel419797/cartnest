"use client";

import type {
  NotificationChannelDto,
  NotificationDto,
  NotificationPreferenceDto,
} from "@repo/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/page-state";
import { apiErrorMessage, notificationsApi } from "../../lib/api";
import { orderStatusClass, orderStatusLabel } from "../orders/order-ui";

const CHANNELS: readonly NotificationChannelDto[] = ["IN_APP", "EMAIL", "SMS"];

function payloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 5)
    .map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${String(value)}`);
  return entries.join(" · ");
}

function defaultEnabled(channel: NotificationChannelDto): boolean {
  return channel !== "SMS";
}

function preferenceEnabled(preferences: readonly NotificationPreferenceDto[], channel: NotificationChannelDto): boolean {
  const row = preferences.find((item) => item.channel === channel && item.scopeKey === "*");
  return row?.enabled ?? defaultEnabled(channel);
}

function NotificationCard({ notification, busy, onRead }: Readonly<{
  notification: NotificationDto;
  busy: boolean;
  onRead: (notification: NotificationDto) => Promise<void>;
}>) {
  const summary = payloadSummary(notification.payload);
  return (
    <article className="panel sellerForm">
      <div className="sectionHeadingCompact">
        <div>
          <p className="eyebrow">{orderStatusLabel(notification.channel)} · {notification.templateKey}</p>
          <h2>{notification.readAt ? "Read notification" : "New notification"}</h2>
          <p>{summary || "CartNest service notification"}</p>
        </div>
        <span className={orderStatusClass(notification.status)}>{orderStatusLabel(notification.status)}</span>
      </div>
      <div className="orderMetadata">
        <span>Created {new Date(notification.createdAt).toLocaleString()}</span>
        {notification.readAt ? <span>Read {new Date(notification.readAt).toLocaleString()}</span> : null}
      </div>
      {!notification.readAt ? (
        <div className="actionRow">
          <button className="secondaryButton" type="button" disabled={busy} onClick={() => void onRead(notification)}>
            {busy ? "Marking…" : "Mark as read"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<readonly NotificationDto[]>([]);
  const [preferences, setPreferences] = useState<readonly NotificationPreferenceDto[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<NotificationChannelDto | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    try {
      const [notificationResponse, preferenceResponse] = await Promise.all([
        notificationsApi.listMine({ pageSize: 100, ...(unreadOnly ? { unreadOnly: true } : {}) }),
        notificationsApi.listPreferences(),
      ]);
      setNotifications(notificationResponse.items);
      setPreferences(preferenceResponse.items);
      setState("ready");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not load your notifications."));
      setState("error");
    }
  }, [unreadOnly]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(notification: NotificationDto) {
    if (notification.readAt) return;
    setBusyId(notification.id);
    setMessage(null);
    try {
      const changed = await notificationsApi.markRead(notification.id);
      setNotifications((current) => unreadOnly
        ? current.filter((item) => item.id !== changed.id)
        : current.map((item) => item.id === changed.id ? changed : item));
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not mark this notification as read."));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleChannel(channel: NotificationChannelDto) {
    const enabled = !preferenceEnabled(preferences, channel);
    setBusyChannel(channel);
    setMessage(null);
    try {
      const changed = await notificationsApi.updatePreference({ channel, scopeKey: "*", enabled });
      setPreferences((current) => [
        ...current.filter((item) => !(item.channel === changed.channel && item.scopeKey === changed.scopeKey)),
        changed,
      ]);
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "CartNest could not update this notification preference."));
    } finally {
      setBusyChannel(null);
    }
  }

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);

  return (
    <main className="commercePage commerceStack">
      <div className="commerceHeader">
        <div className="commerceHeaderCopy">
          <p className="eyebrow">Notifications</p>
          <h1 className="pageTitle">Notification center</h1>
          <p>Review in-app service updates and control optional channel defaults. Required security, payment, refund, and other mandatory service notices remain server-enforced.</p>
        </div>
        <button className="secondaryButton" type="button" disabled={state === "loading"} onClick={() => void load()}>{state === "loading" ? "Refreshing…" : "Refresh"}</button>
      </div>

      {message ? <p className="formMessage formMessageError" role="alert">{message}</p> : null}

      <section className="panel sellerForm" aria-labelledby="notification-preferences-heading">
        <div className="sectionHeadingCompact">
          <div><h2 id="notification-preferences-heading">Optional channel defaults</h2><p>Email and in-app optional notices default on; SMS defaults off until you opt in.</p></div>
        </div>
        <div className="formGrid formGridTwo">
          {CHANNELS.map((channel) => {
            const enabled = preferenceEnabled(preferences, channel);
            return (
              <label className="field" key={channel}>
                <span>{orderStatusLabel(channel)}</span>
                <button className={enabled ? "secondaryButton" : "ghostButton"} type="button" disabled={busyChannel !== null || state !== "ready"} onClick={() => void toggleChannel(channel)}>
                  {busyChannel === channel ? "Saving…" : enabled ? "Optional notices enabled" : "Optional notices disabled"}
                </button>
              </label>
            );
          })}
        </div>
      </section>

      <section className="commerceStack" aria-labelledby="notification-inbox-heading">
        <div className="sectionHeadingCompact">
          <div><h2 id="notification-inbox-heading">In-app inbox</h2><p>{unreadCount} unread item(s) currently loaded.</p></div>
          <label className="field">View
            <select value={unreadOnly ? "unread" : "all"} onChange={(event) => setUnreadOnly(event.target.value === "unread") }>
              <option value="all">All notifications</option>
              <option value="unread">Unread only</option>
            </select>
          </label>
        </div>

        {state === "loading" ? <LoadingState label="Loading notifications…" /> : null}
        {state === "error" ? <ErrorState title="Notifications unavailable" message={message ?? "CartNest could not load your notification inbox."} action={<button className="secondaryButton" type="button" onClick={() => void load()}>Try again</button>} /> : null}
        {state === "ready" && notifications.length === 0 ? <EmptyState title="No notifications" message={unreadOnly ? "You have no unread in-app notifications." : "Your in-app service notifications will appear here."} /> : null}
        {state === "ready" ? notifications.map((notification) => <NotificationCard key={notification.id} notification={notification} busy={busyId === notification.id} onRead={markRead} />) : null}
      </section>
    </main>
  );
}
