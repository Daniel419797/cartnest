import {
  CartNestApiError,
  createAdminApi,
  createCartApi,
  createCartNestApiClient,
  createCatalogApi,
  createContractRequestClient,
  createInventoryApi,
  createLogisticsApi,
  createNotificationsApi,
  createOrdersApi,
  createPaymentsApi,
  createPrivacyApi,
  createReturnsApi,
  createVendorApi,
  createWishlistApi,
} from "@repo/api-client";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = "cartnest_csrf=";
  const item = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : undefined;
}

const browserFetch: typeof globalThis.fetch = async (input, init) => {
  const sourceRequest = input instanceof Request ? input : undefined;
  const method = (init?.method ?? sourceRequest?.method ?? "GET").toUpperCase();
  const headers = new Headers(sourceRequest?.headers);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  return globalThis.fetch(input, { ...init, headers, credentials: "include" });
};

export const api = createCartNestApiClient({ baseUrl: API_BASE_URL, fetch: browserFetch });
const contractApi = createContractRequestClient({ baseUrl: API_BASE_URL, fetch: browserFetch });
export const vendorApi = createVendorApi(contractApi);
export const catalogApi = createCatalogApi(contractApi);
export const inventoryApi = createInventoryApi(contractApi);
export const wishlistApi = createWishlistApi(contractApi);
export const cartApi = createCartApi(contractApi);
export const ordersApi = createOrdersApi(contractApi);
export const logisticsApi = createLogisticsApi(contractApi);
export const paymentsApi = createPaymentsApi(contractApi);
export const returnsApi = createReturnsApi(contractApi);
export const adminApi = createAdminApi(contractApi);
export const notificationsApi = createNotificationsApi(contractApi);
export const privacyApi = createPrivacyApi(contractApi);

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof CartNestApiError) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    const envelope = (error as { error?: { message?: unknown } }).error;
    if (envelope && typeof envelope.message === "string") return envelope.message;
  }
  return fallback;
}

export function apiErrorCode(error: unknown): string | undefined {
  if (error instanceof CartNestApiError) return error.code;
  if (error && typeof error === "object" && "error" in error) {
    const envelope = (error as { error?: { code?: unknown } }).error;
    return typeof envelope?.code === "string" ? envelope.code : undefined;
  }
  return undefined;
}
