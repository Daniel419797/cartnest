"use client";

import { AuthGuard } from "../../components/auth-guard";
import { AdminConsole } from "../../features/admin/admin-console";

export default function AdminPage() {
  return <AuthGuard><AdminConsole /></AuthGuard>;
}
