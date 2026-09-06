import type {
  AdminReviewListQueryDto,
  CreateProductReviewBodyDto,
  CreateRefundBodyDto,
  CreateReturnBodyDto,
  CreateStoreReviewBodyDto,
  PaginationQueryDto,
  RefundDto,
  RefundListQueryDto,
  RefundListResponseDto,
  RestockReturnResponseDto,
  ReturnListQueryDto,
  ReturnListResponseDto,
  ReturnRequestDto,
  ReviewDto,
  ReviewListResponseDto,
  ReviewModerationBodyDto,
  UpdateReturnStatusBodyDto,
} from "@repo/contracts";
import type { ContractRequestClient } from "./contract-client.js";

function segment(value: string): string {
  return encodeURIComponent(value);
}

function queryString(values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function createReturnsApi(client: ContractRequestClient) {
  return {
    createReturn(body: CreateReturnBodyDto): Promise<ReturnRequestDto> {
      return client.request("/api/v1/returns", { method: "POST", body });
    },

    listMyReturns(query: ReturnListQueryDto = {}): Promise<ReturnListResponseDto> {
      return client.request(`/api/v1/returns${queryString(query)}`);
    },

    getMyReturn(returnRequestId: string): Promise<ReturnRequestDto> {
      return client.request(`/api/v1/returns/${segment(returnRequestId)}`);
    },

    cancelMyReturn(returnRequestId: string): Promise<ReturnRequestDto> {
      return client.request(`/api/v1/returns/${segment(returnRequestId)}/cancel`, { method: "POST" });
    },

    listStoreReturns(storeId: string, query: ReturnListQueryDto = {}): Promise<ReturnListResponseDto> {
      return client.request(`/api/v1/stores/${segment(storeId)}/returns${queryString(query)}`);
    },

    updateReturnStatus(
      returnRequestId: string,
      body: UpdateReturnStatusBodyDto,
    ): Promise<ReturnRequestDto> {
      return client.request(`/api/v1/returns/${segment(returnRequestId)}/status`, {
        method: "POST",
        body,
      });
    },

    restockReturn(returnRequestId: string): Promise<RestockReturnResponseDto> {
      return client.request(`/api/v1/returns/${segment(returnRequestId)}/restock`, { method: "POST" });
    },

    listVendorOrderRefunds(
      vendorOrderId: string,
      query: RefundListQueryDto = {},
    ): Promise<RefundListResponseDto> {
      return client.request(`/api/v1/vendor-orders/${segment(vendorOrderId)}/refunds${queryString(query)}`);
    },

    requestVendorRefund(
      vendorOrderId: string,
      body: CreateRefundBodyDto,
      idempotencyKey: string,
    ): Promise<RefundDto> {
      return client.request(`/api/v1/vendor-orders/${segment(vendorOrderId)}/refunds`, {
        method: "POST",
        body,
        headers: { "idempotency-key": idempotencyKey },
      });
    },

    listAdminRefunds(query: RefundListQueryDto = {}): Promise<RefundListResponseDto> {
      return client.request(`/api/v1/admin/refunds${queryString(query)}`);
    },

    approveRefund(refundId: string): Promise<RefundDto> {
      return client.request(`/api/v1/admin/refunds/${segment(refundId)}/approve`, { method: "POST" });
    },

    reconcileRefund(refundId: string): Promise<RefundDto> {
      return client.request(`/api/v1/admin/refunds/${segment(refundId)}/reconcile`, { method: "POST" });
    },

    createProductReview(body: CreateProductReviewBodyDto): Promise<ReviewDto> {
      return client.request("/api/v1/reviews/products", { method: "POST", body });
    },

    createStoreReview(body: CreateStoreReviewBodyDto): Promise<ReviewDto> {
      return client.request("/api/v1/reviews/stores", { method: "POST", body });
    },

    listProductReviews(productId: string, query: PaginationQueryDto = {}): Promise<ReviewListResponseDto> {
      return client.request(`/api/v1/products/${segment(productId)}/reviews${queryString(query)}`);
    },

    listStoreReviews(storeId: string, query: PaginationQueryDto = {}): Promise<ReviewListResponseDto> {
      return client.request(`/api/v1/stores/${segment(storeId)}/reviews${queryString(query)}`);
    },

    listAdminReviews(query: AdminReviewListQueryDto = {}): Promise<ReviewListResponseDto> {
      return client.request(`/api/v1/admin/reviews${queryString(query)}`);
    },

    moderateReview(reviewId: string, body: ReviewModerationBodyDto): Promise<ReviewDto> {
      return client.request(`/api/v1/admin/reviews/${segment(reviewId)}/moderate`, {
        method: "POST",
        body,
      });
    },
  };
}

export type ReturnsApi = ReturnType<typeof createReturnsApi>;
