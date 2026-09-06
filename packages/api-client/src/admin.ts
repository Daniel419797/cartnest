import type {
  AdminListQueryDto,
  AdminOrderListResponseDto,
  AdminOrderOperationsDetailDto,
  AdminPaymentListResponseDto,
  AdminRefundListResponseDto,
  AdminUserListResponseDto,
  AnalyticsRangeQueryDto,
  CreatePromotionBodyDto,
  CreateTaxRateBodyDto,
  PlatformAnalyticsDto,
  PromotionDto,
  PromotionListResponseDto,
  PromotionStatusDto,
  StoreAnalyticsDto,
  TaxRateDto,
  TaxRateListResponseDto,
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

export interface AdminApi {
  getPlatformAnalytics(query?: AnalyticsRangeQueryDto): Promise<PlatformAnalyticsDto>;
  getStoreAnalytics(storeId: string, query?: AnalyticsRangeQueryDto): Promise<StoreAnalyticsDto>;
  listUsers(query?: AdminListQueryDto): Promise<AdminUserListResponseDto>;
  listOrders(query?: AdminListQueryDto): Promise<AdminOrderListResponseDto>;
  getOrderOperations(orderId: string): Promise<AdminOrderOperationsDetailDto>;
  listPayments(query?: AdminListQueryDto): Promise<AdminPaymentListResponseDto>;
  listRefunds(query?: AdminListQueryDto): Promise<AdminRefundListResponseDto>;
  listTaxRates(): Promise<TaxRateListResponseDto>;
  createTaxRate(body: CreateTaxRateBodyDto): Promise<TaxRateDto>;
  setTaxRateActive(taxRateId: string, active: boolean): Promise<TaxRateDto>;
  listPromotions(): Promise<PromotionListResponseDto>;
  createPromotion(body: CreatePromotionBodyDto): Promise<PromotionDto>;
  setPromotionStatus(promotionId: string, status: PromotionStatusDto): Promise<PromotionDto>;
}

export function createAdminApi(client: ContractRequestClient): AdminApi {
  return {
    getPlatformAnalytics(query = {}) {
      return client.request<PlatformAnalyticsDto>(withQuery("/api/v1/admin/analytics", query));
    },
    getStoreAnalytics(storeId, query = {}) {
      return client.request<StoreAnalyticsDto>(withQuery(`/api/v1/stores/${pathSegment(storeId)}/analytics`, query));
    },
    listUsers(query = {}) {
      return client.request<AdminUserListResponseDto>(withQuery("/api/v1/admin/users", query));
    },
    listOrders(query = {}) {
      return client.request<AdminOrderListResponseDto>(withQuery("/api/v1/admin/orders", query));
    },
    getOrderOperations(orderId) {
      return client.request<AdminOrderOperationsDetailDto>(`/api/v1/admin/orders/${pathSegment(orderId)}/operations`);
    },
    listPayments(query = {}) {
      return client.request<AdminPaymentListResponseDto>(withQuery("/api/v1/admin/payment-intents", query));
    },
    listRefunds(query = {}) {
      return client.request<AdminRefundListResponseDto>(withQuery("/api/v1/admin/refunds", query));
    },
    listTaxRates() {
      return client.request<TaxRateListResponseDto>("/api/v1/admin/tax-rates");
    },
    createTaxRate(body) {
      return client.request<TaxRateDto>("/api/v1/admin/tax-rates", { method: "POST", body });
    },
    setTaxRateActive(taxRateId, active) {
      return client.request<TaxRateDto>(`/api/v1/admin/tax-rates/${pathSegment(taxRateId)}`, { method: "PATCH", body: { active } });
    },
    listPromotions() {
      return client.request<PromotionListResponseDto>("/api/v1/admin/promotions");
    },
    createPromotion(body) {
      return client.request<PromotionDto>("/api/v1/admin/promotions", { method: "POST", body });
    },
    setPromotionStatus(promotionId, status) {
      return client.request<PromotionDto>(`/api/v1/admin/promotions/${pathSegment(promotionId)}/status`, { method: "PATCH", body: { status } });
    },
  };
}
