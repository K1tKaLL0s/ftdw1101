import { NextRequest } from "next/server";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { rpc } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { requireWeekParam } from "@/lib/server/pagination";
import { listTournaments, tournamentWriteLimit } from "@/lib/server/services/tournaments";
import { tournamentCreateSchema } from "@/lib/tournaments/validation";

export const dynamic = "force-dynamic";
export const GET = api(async (request: NextRequest) => {
  const { tokenHash } = await requireSession();
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new AppError(422, "invalid_offset", "列表页码无效。");
  const week = request.nextUrl.searchParams.get("week");
  return json(await listTournaments(tokenHash, offset, week === null ? null : requireWeekParam(week)));
});
export const POST = api(async (request: NextRequest) => {
  assertSameOrigin(request);
  const input = await readJson(request, tournamentCreateSchema);
  const { session, tokenHash } = await requireSession();
  await tournamentWriteLimit(session.id);
  const id = await rpc<string>("app_tournament_create", { p_session_hash: tokenHash, p_input: input });
  return json({ id }, { status: 201 });
});
