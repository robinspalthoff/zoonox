import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { processInboundItem } from "@/lib/inbound/process";
import type { BrevoInboundPayload } from "@/lib/inbound/brevo";

// Inbound-Mail-Webhook (Brevo Inbound Parsing).
//
// Brevo signiert Inbound-Webhooks nicht — die Authentifizierung läuft daher
// über ein langes, geheimes Token im URL-Pfad (constant-time verglichen).
// Konfiguriere die Webhook-URL bei Brevo als
//   https://<app>/api/inbound/email/<INBOUND_WEBHOOK_SECRET>
//
// Der Endpoint antwortet bei gültigem Secret immer mit 200, auch wenn einzelne
// Mails abgelehnt werden — so vermeidet man unnötige Retry-Stürme. Das Ergebnis
// jeder Mail steht im InboundMailLog.

export const runtime = "nodejs";

function secretMatches(provided: string): boolean {
  const expected = process.env.INBOUND_WEBHOOK_SECRET ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type RouteContext = { params: Promise<{ secret: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { secret } = await ctx.params;
  if (!secretMatches(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: BrevoInboundPayload;
  try {
    payload = (await req.json()) as BrevoInboundPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items = payload.items ?? [];
  for (const item of items) {
    try {
      await processInboundItem(item);
    } catch (err) {
      // Pro-Item-Fehler dürfen nicht die ganze Zustellung scheitern lassen.
      console.error("[inbound] item processing failed:", err);
    }
  }

  return NextResponse.json({ ok: true, received: items.length });
}
