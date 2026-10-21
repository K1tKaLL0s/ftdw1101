import { NextRequest } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { AppError } from "@/lib/server/errors";
import { actOnTournament, getTournament, tournamentWriteLimit } from "@/lib/server/services/tournaments";
import { tournamentActionSchema } from "@/lib/tournaments/validation";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
function checkedId(id: string) { if (!z.uuid().safeParse(id).success) throw new AppError(404, "not_found", "找不到这场赛事。"); return id; }
export const GET = api(async (_request: NextRequest, context: Context) => {
  const id = checkedId((await context.params).id);
  const { tokenHash } = await requireSession();
  return json(await getTournament(tokenHash, id));
});
export const POST = api(async (request: NextRequest, context: Context) => {
  assertSameOrigin(request);
  const id = checkedId((await context.params).id);
  const input = await readJson(request, tournamentActionSchema);
  const { session, tokenHash } = await requireSession();
  await tournamentWriteLimit(session.id);
  await actOnTournament(tokenHash, id, input);
  return json({ ok: true });
});
