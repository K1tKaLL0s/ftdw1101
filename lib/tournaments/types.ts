import type { Rules, State } from "./engine";
import type { ThreeGodsState } from "./three-gods";

export type TournamentStatus = "draft" | "published" | "running" | "completed" | "cancelled";
export type Tournament = {
  id: string; title: string; location: string; description: string; starts_at: string;
  registration_deadline: string; timezone: string; capacity: number; format: Rules["format"] | "three_gods";
  swiss_rounds: number; top_cut: number; tie_break_policy: string; extra_rules: string;
  status: TournamentStatus; revision: number; state: State | null; created_at: string; entry_count: number; checked_in_count: number;
  special_grouping: "ab" | "single"; special_state: ThreeGodsState | null;
};
export type EntryStatus = "preregistered" | "checked_in" | "withdrawn";
export type TournamentDetail = { tournament: Tournament; entrants: { id: string; name: string; status: EntryStatus }[]; mine: string | null; canManage: boolean };
export const formatNames = { swiss_cut: "传统瑞士轮 + 淘汰赛", pseudo_double: "胜败组伪双败", three_gods: "三幻神争夺" };
export const statusNames: Record<TournamentStatus, string> = { draft: "草稿", published: "报名中", running: "进行中", completed: "已结束", cancelled: "已取消" };
export const ruleLines = [
  "校赛透明预设：胜 3 分、平 1 分、负 0 分；双方判负各 0 分；轮空 3 分。",
  "按总分 → OMW（对手真实积分率均值）→ OOMW（对手 OMW 均值）排序。真实积分率 = (3×胜场 + 平局) ÷ (3×真实完成对局数)。",
  "轮空不计对手、不计真实对局分母、不算败场；无真实对手时内部按 0 计算，显示 —；不设 33% 下限。退赛不补未来负场。",
  "同分优先配对、避免重赛；奇数人数优先给低分且未轮空选手轮空。无法合法配对时暂停并提示组织者处理。",
  "这是校赛公布的规则，非 KTS 完整复制。开赛锁定；后续配对或阶段公布后，不静默修改上游结果重排。",
];
export function tournamentRules(t: Tournament): Rules { if (t.format === "three_gods") throw new Error("三幻神规则尚待确认，不能启动自动赛程。"); return { format: t.format, swissRounds: t.swiss_rounds, topCut: t.top_cut }; }
