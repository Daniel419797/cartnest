import type {
  NotificationDto,
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationPreferenceDto,
  NotificationPreferenceListResponseDto,
  OperationalNotificationListResponseDto,
  OperationalNotificationQueryDto,
  UpdateNotificationPreferenceBodyDto,
} from "@repo/contracts";
import type { ContractRequestClient } from "./contract-client.js";

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(path: string, query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export interface NotificationsApi {
  listMine(query?: NotificationListQueryDto): Promise<NotificationListResponseDto>;
  markRead(notificationId: string): Promise<NotificationDto>;
  listPreferences(): Promise<NotificationPreferenceListResponseDto>;
  updatePreference(body: UpdateNotificationPreferenceBodyDto): Promise<NotificationPreferenceDto>;
  listOperational(query?: OperationalNotificationQueryDto): Promise<OperationalNotificationListResponseDto>;
  retryOperational(notificationId: string): Promise<{ accepted: true }>;
}

export function createNotificationsApi(client: ContractRequestClient): NotificationsApi {
  return {
    listMine(query = {}) {
      return client.request<NotificationListResponseDto>(withQuery("/api/v1/notifications", query));
    },
    markRead(notificationId) {
      return client.request<NotificationDto>(`/api/v1/notifications/${pathSegment(notificationId)}/read`, { method: "POST" });
    },
    listPreferences() {
      return client.request<NotificationPreferenceListResponseDto>("/api/v1/notification-preferences");
    },
    updatePreference(body) {
      return client.request<NotificationPreferenceDto>("/api/v1/notification-preferences", { method: "PUT", body });
    },
    listOperational(query = {}) {
      return client.request<OperationalNotificationListResponseDto>(withQuery("/api/v1/admin/notifications", query));
    },
    retryOperational(notificationId) {
      return client.request<{ accepted: true }>(`/api/v1/admin/notifications/${pathSegment(notificationId)}/retry`, { method: "POST" });
    },
  };
}
