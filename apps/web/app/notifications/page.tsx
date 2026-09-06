"use client";

import { AuthGuard } from "../../components/auth-guard";
import { NotificationCenter } from "../../features/notifications/notification-center";

export default function NotificationsPage() {
  return <AuthGuard><NotificationCenter /></AuthGuard>;
}
