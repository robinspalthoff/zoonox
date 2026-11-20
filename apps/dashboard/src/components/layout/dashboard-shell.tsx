"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import type { Role, TenantRole } from "@prisma/client";
import type { NotificationSummary } from "@/lib/comments/queries";

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string | null;
  userEmail: string | null;
  userRole: Role;
  tenantRole: TenantRole;
  tenantCount: number;
  notifications: NotificationSummary;
}

export function DashboardShell({
  children,
  userName,
  userEmail,
  userRole,
  tenantRole,
  tenantCount,
  notifications,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        role={userRole}
        tenantRole={tenantRole}
        tenantCount={tenantCount}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header userName={userName} userEmail={userEmail} notifications={notifications} />
        <main className="flex-1 overflow-y-auto ">{children}</main>
      </div>
    </div>
  );
}
