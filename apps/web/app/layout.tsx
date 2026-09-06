import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "../components/app-header";
import { SessionProvider } from "../components/session-provider";
import "./globals.css";
import "./vendor.css";
import "./catalog.css";
import "./commerce.css";
import "./orders.css";
import "./orders-payments.css";
import "./navigation.css";
import "./fp10.css";

export const metadata: Metadata = {
  title: {
    default: "CartNest",
    template: "%s · CartNest",
  },
  description: "A multi-vendor e-commerce marketplace for Nigerian businesses and customers.",
  applicationName: "CartNest",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppHeader />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
