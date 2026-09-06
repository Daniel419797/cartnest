"use client";

import { AuthGuard } from "../../components/auth-guard";
import { BuyerReturnsPage } from "../../features/returns/buyer-returns-page";

export default function ReturnsPage() {
  return <AuthGuard><BuyerReturnsPage /></AuthGuard>;
}
