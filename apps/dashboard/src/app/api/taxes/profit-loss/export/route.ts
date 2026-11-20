import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/lib/require-tenant";
import { db } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { ProfitLossPDF } from "@/components/pdf/profit-loss-pdf";
import { computeProfitLoss, type ProfitLossMethod } from "@/lib/reports/profit-loss";
import { getSkrAccount, getSkrAccountLabel } from "@/lib/skr-accounts";
import { getTranslations } from "next-intl/server";
import type { SkrType } from "@prisma/client";
import React from "react";

export async function GET(req: NextRequest) {
  let t;
  try {
    t = await requireTenantOrThrow();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const method: ProfitLossMethod = sp.get("method") === "GUV" ? "GUV" : "EUR";
  const fromStr = sp.get("from");
  const toStr = sp.get("to");

  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getFullYear(), 0, 1));
  const defaultTo = new Date(Date.UTC(now.getFullYear(), 11, 31));
  const from = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : defaultFrom;
  const to = toStr ? new Date(`${toStr}T23:59:59.999Z`) : defaultTo;

  const settings = await db.companySettings.findUnique({ where: { tenantId: t.tenantId } });
  const skrType = (settings?.skrType ?? "SKR03") as SkrType;

  const result = await computeProfitLoss({ tenantId: t.tenantId, from, to, method, skrType });
  const tAccounts = await getTranslations("skrAccounts");

  type Group = {
    key: string;
    label: string;
    total: number;
    rows: Array<{ code: string; label: string; value: number }>;
  };

  function buildGroups(buckets: Map<string, number>): Group[] {
    const map = new Map<string, Group>();
    for (const [code, value] of buckets) {
      const account = getSkrAccount(code, skrType);
      const groupKey = account?.group ?? "other";
      const groupLabel = tAccounts(`groups.${groupKey}` as never);
      const label = getSkrAccountLabel(code, skrType, (k) => tAccounts(k as never));
      let g = map.get(groupKey);
      if (!g) {
        g = { key: groupKey, label: groupLabel, rows: [], total: 0 };
        map.set(groupKey, g);
      }
      g.rows.push({ code, label, value });
      g.total += value;
    }
    for (const g of map.values()) g.rows.sort((a, b) => b.value - a.value);
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  const incomeGroups = buildGroups(result.incomeBuckets);
  const expenseGroups = buildGroups(result.expenseBuckets);

  const generatedAt = new Date();
  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(ProfitLossPDF, {
      settings,
      result,
      incomeGroups,
      expenseGroups,
      generatedAt,
    }) as any,
  );

  const stamp = generatedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const type = method === "EUR" ? "EÜR" : "GuV";
  const filename = `${stamp}_${type}.pdf`;
  const asciiFilename = filename.replace(/Ü/g, "Ue");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
