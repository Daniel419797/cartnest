import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

function apiOrigin(): string | undefined {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const connectSources = ["'self'", apiOrigin(), ...(production ? [] : ["ws:", "http:", "https:"])].filter(Boolean).join(" ");
const scriptSources = ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])].join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src ${scriptSources}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src ${connectSources}`,
  "frame-src https://checkout.paystack.com https://checkout.flutterwave.com",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const sensitiveHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
];

const sensitiveRoutes = ["/account/:path*", "/admin/:path*", "/notifications/:path*", "/checkout/:path*", "/orders/:path*", "/returns/:path*", "/vendor/:path*"];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@repo/ui"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...sensitiveRoutes.map((source) => ({ source, headers: sensitiveHeaders })),
    ];
  },
};

export default nextConfig;
