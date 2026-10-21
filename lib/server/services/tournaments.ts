import "server-only";
import { randomInt } from "node:crypto";
import { rpc } from "../db";
import { AppError } from "../errors";
import { consumeRateLimits } from "../security";
import { advanceToCut, dropEntrant, manualSwissRound, nextSwissRound, recordResult, startTournament, TournamentError } from "@/lib/tournaments/engine";
import { tournamentRules, type Tournament, type TournamentDetail } from "@/lib/tournaments/types";
import type { TournamentAction } from "@/lib/tournaments/validation";
import { applyThreeGodsCommand, specialRoster } from "@/lib/tournaments/three-gods";

export function listTournaments(tokenHash: string, offset = 0, weekKey: string | null = null) {
  return rpc<{ items: Tournament[]; nextOffset: number | null }>("app_tournament_list", { p_session_hash: tokenHash, p_offset: offset, p_week_key: weekKey });
}
export function getTournament(tokenHash: string, id: string) {
  return rpc<TournamentDetail>("app_tournament_detail", { p_session_hash: tokenHash, p_id: id });
}
export async function tournamentWriteLimit(userId: string) {
  await consumeRateLimits([{ key: "account:" + userId + ":tournament-write", limit: 60, windowSeconds: 60 }]);
}
export async function actOnTournament(tokenHash: string, id: string, input: TournamentAction) {
  if (input.action === "join" || input.action === "leave" || input.action === "checkin") {
    return rpc("app_tournament_registration", { p_session_hash: tokenHash, p_id: id, p_action: input.action,
      p_name: input.action === "join" ? input.name : "", p_entry_id: input.action === "checkin" ? input.entryId : null });
  }
  if (input.action === "publish" || input.action === "cancel") {
    return rpc("app_tournament_status", { p_session_hash: tokenHash, p_id: id, p_revision: input.revision,
      p_status: input.action === "publish" ? "published" : "cancelled", p_reason: input.action === "cancel" ? input.reason : "" });
  }
  const detail = await getTournament(tokenHash, id);
  if (!detail.canManage) throw new AppError(403, "forbidden", "只有发布者或平台管理员可以管理这场赛事。");
  const t = detail.tournament;
  if (input.action === "special") {
    if (t.format !== "three_gods" || !t.special_state || !["running", "completed"].includes(t.status)) throw new AppError(409, "not_started", "请先确认当天报到名单并锁定选手池。");
    const original = t.special_state;
    if (t.revision !== input.revision && !original.commands[input.commandId]) throw new AppError(409, "conflict", "赛事状态已变化，请刷新后重试。");
    try {
      const next = applyThreeGodsCommand(original, input.commandId, input.command, () => randomInt(0, 0x100000000) / 0x100000000);
      if (next === original) return { ok: true };
      return await rpc("app_tournament_special_commit", { p_session_hash: tokenHash, p_id: id, p_revision: input.revision,
        p_state: next, p_command_id: input.commandId, p_fingerprint: next.commands[input.commandId] });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(409, "special_rules", error instanceof Error ? error.message : "特殊赛制操作失败。");
    }
  }
  if (t.revision !== input.revision) throw new AppError(409, "conflict", "赛事状态已变化，请刷新后重试。");
  if (input.action === "start" && t.format === "three_gods") {
    if (t.status !== "published" || t.special_state) throw new AppError(409, "already_started", "选手池已锁定或当前不能开赛。");
    const entrants = detail.entrants.filter(e => e.status === "checked_in");
    if (entrants.length < (t.special_grouping === "ab" ? 4 : 2)) throw new AppError(409, "insufficient_players", "已报到人数不足；不分组需至少 2 人，A/B 需至少 4 人。");
    return rpc("app_tournament_special_start", { p_session_hash: tokenHash, p_id: id, p_revision: input.revision, p_state: specialRoster(t.special_grouping, entrants) });
  }
  if (input.action !== "start" && !t.state) throw new AppError(409, "not_started", "请先确认当天报到名单并开赛。");
  if (input.action === "start" && (t.status !== "published" || t.state)) throw new AppError(409, "already_started", "这场赛事当前不能开赛。");
  const rules = tournamentRules(t);
  let next;
  try {
    switch (input.action) {
      case "start": next = startTournament(rules, detail.entrants.filter(entry => entry.status === "checked_in").map((entry, i) => ({ id: entry.id, name: entry.name, seed: i + 1, active: true }))); break;
      case "next_swiss": next = nextSwissRound(rules, t.state!); break;
      case "manual_swiss": next = manualSwissRound(rules, t.state!, input.pairs, input.reason, input.allowRematches, input.allowRepeatBye); break;
      case "cut": next = advanceToCut(rules, t.state!, input.orderedIds, input.reason); break;
      case "result": next = recordResult(t.state!, input.matchId, input.result, input.reason); break;
      case "drop": next = dropEntrant(t.state!, input.entryId, input.reason); break;
    }
  } catch (error) {
    if (error instanceof TournamentError) throw new AppError(409, "tournament_rules", error.message);
    throw error;
  }
  if (t.status === "cancelled") throw new AppError(409, "cancelled", "赛事已取消。");
  return rpc("app_tournament_commit", { p_session_hash: tokenHash, p_id: id, p_revision: input.revision, p_state: next, p_action: input.action });
}
