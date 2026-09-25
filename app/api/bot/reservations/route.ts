import { NextResponse } from "next/server";
import { authorizeBot, botDateRange, botPayload } from "@/lib/bot-query";
import { getServiceClient } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { consumeRateLimits } from "@/lib/server/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", Vary: "Authorization, X-Group-Id" };
  try {
    const auth = authorizeBot(request, process.env);
    await consumeRateLimits([{ key: `bot-query:${auth.digest}`, limit: 30, windowSeconds: 60 }]);
    const now = new Date();
    const { start, end } = botDateRange(auth.range, now);
    const { data, error } = await getServiceClient().rpc("bot_reservation_slots", {
      p_start_date: start, p_end_date: end, p_max_members: 5, p_include_notes: auth.showNotes,
    }).abortSignal(AbortSignal.timeout(6_000));
    if (error) throw new Error("Reservation lookup failed");
    return NextResponse.json(botPayload(data, auth.range, now, auth.showNotes), { headers });
  } catch (reason) {
    const error = reason instanceof AppError ? reason : new AppError(503, "upstream_error", "暂时无法读取预约，请稍后重试。");
    if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers });
  }
}
