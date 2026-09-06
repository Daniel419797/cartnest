import type {
  AdminPrivacyRequestListResponseDto,
  PrivacyExportDto,
  PrivacyRequestDto,
  PrivacyRequestListQueryDto,
  PrivacyRequestListResponseDto,
  ProcessPrivacyRequestBodyDto,
} from "@repo/contracts";
import type { ContractRequestClient } from "./contract-client.js";

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function withQuery(path: string, query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export interface PrivacyApi {
  exportMine(): Promise<PrivacyExportDto>;
  requestErasure(): Promise<PrivacyRequestDto>;
  listMine(query?: PrivacyRequestListQueryDto): Promise<PrivacyRequestListResponseDto>;
  listAdmin(query?: PrivacyRequestListQueryDto): Promise<AdminPrivacyRequestListResponseDto>;
  processAdminRequest(privacyRequestId: string, body: ProcessPrivacyRequestBodyDto): Promise<PrivacyRequestDto>;
}

export function createPrivacyApi(client: ContractRequestClient): PrivacyApi {
  return {
    exportMine() {
      return client.request<PrivacyExportDto>("/api/v1/privacy/export");
    },
    requestErasure() {
      return client.request<PrivacyRequestDto>("/api/v1/privacy/erasure-requests", { method: "POST" });
    },
    listMine(query = {}) {
      return client.request<PrivacyRequestListResponseDto>(withQuery("/api/v1/privacy/erasure-requests", query));
    },
    listAdmin(query = {}) {
      return client.request<AdminPrivacyRequestListResponseDto>(withQuery("/api/v1/admin/privacy/erasure-requests", query));
    },
    processAdminRequest(privacyRequestId, body) {
      return client.request<PrivacyRequestDto>(
        `/api/v1/admin/privacy/erasure-requests/${pathSegment(privacyRequestId)}/process`,
        { method: "POST", body },
      );
    },
  };
}
