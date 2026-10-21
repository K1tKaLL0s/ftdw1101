import { z } from "zod";
import { eventTimezones } from "./dates";
import { threeGodsCommandSchema } from "./three-gods";

export function titleLength(value: string): number {
  return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(value.trim())].length;
}
export const tournamentCreateSchema = z.object({
  title: z.string().trim().refine(value => titleLength(value) >= 1 && titleLength(value) <= 25, "赛事名须为 1–25 字（表情按一个可感知字符计算）。"),
  description: z.string().max(2000).default(""),
  location: z.string().trim().min(1, "请填写举办地点。").max(120),
  starts_at: z.iso.datetime({ offset: true }),
  registration_deadline: z.iso.datetime({ offset: true }),
  timezone: z.enum(eventTimezones).default("Asia/Shanghai"),
  capacity: z.number().int().min(2).max(128),
  format: z.enum(["swiss_cut", "pseudo_double", "three_gods"]),
  special_grouping: z.enum(["ab", "single"]).default("single"),
  swiss_rounds: z.number().int().min(3).max(7),
  top_cut: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  tie_break_policy: z.string().trim().min(4).max(300),
  extra_rules: z.string().max(3000).default(""),
  status: z.enum(["draft", "published"]),
}).superRefine((value, context) => {
  if (value.format === "three_gods" && value.special_grouping === "ab" && value.capacity < 4) context.addIssue({ code: "custom", path: ["capacity"], message: "A/B 分组至少需要 4 人。" });
  if (Date.parse(value.registration_deadline) > Date.parse(value.starts_at)) context.addIssue({ code: "custom", path: ["registration_deadline"], message: "报名截止不能晚于开赛时间。" });
  if (Date.parse(value.registration_deadline) <= Date.now()) context.addIssue({ code: "custom", path: ["registration_deadline"], message: "请选择未来的报名截止时间。" });
  if (value.format === "swiss_cut" && value.top_cut > value.capacity) context.addIssue({ code: "custom", path: ["top_cut"], message: "晋级人数不能超过人数上限。" });
  if (value.format === "swiss_cut" && value.swiss_rounds > value.capacity - (value.capacity % 2 === 0 ? 1 : 0)) context.addIssue({ code: "custom", path: ["capacity"], message: "人数上限不足以在避免重赛时完成所选瑞士轮数。" });
});
const revision = z.number().int().min(0);
export const tournamentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("special"), revision, commandId: z.uuid(), command: threeGodsCommandSchema }),
  z.object({ action: z.literal("join"), name: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("checkin"), entryId: z.uuid() }),
  z.object({ action: z.literal("publish"), revision }),
  z.object({ action: z.literal("cancel"), revision, reason: z.string().trim().min(4).max(300) }),
  z.object({ action: z.literal("start"), revision }),
  z.object({ action: z.literal("next_swiss"), revision }),
  z.object({ action: z.literal("manual_swiss"), revision, pairs: z.array(z.object({ a: z.uuid(), b: z.uuid().nullable() })).min(1).max(64), reason: z.string().trim().min(4).max(300), allowRematches: z.boolean().default(false), allowRepeatBye: z.boolean().default(false) }),
  z.object({ action: z.literal("cut"), revision, orderedIds: z.array(z.uuid()).max(128).optional(), reason: z.string().max(300).default("") }),
  z.object({ action: z.literal("result"), revision, matchId: z.string().min(1).max(30), result: z.enum(["a_win", "b_win", "draw", "double_loss"]), reason: z.string().max(300).default("") }),
  z.object({ action: z.literal("drop"), revision, entryId: z.uuid(), reason: z.string().trim().min(4).max(300) }),
]);
export type TournamentAction = z.infer<typeof tournamentActionSchema>;
