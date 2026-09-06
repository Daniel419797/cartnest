"use client";

import { AuthGuard } from "../../../components/auth-guard";
import { AdminP9Operations } from "../../../features/returns/admin-p9-operations";

export default function AdminP9Page() {
  return <AuthGuard><AdminP9Operations /></AuthGuard>;
}
