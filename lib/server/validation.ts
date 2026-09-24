import { z } from "zod";
import { SCHEDULE_VERSION, SLOT_COUNT, WEEK_CELL_COUNT } from "../schedule";

const username = z.string().trim().transform((value) => value.toLowerCase()).pipe(
  z.string().regex(/^[a-z0-9_]{3,24}$/, "用户名需为 3–24 位小写英文字母、数字或下划线。"),
);
const password = z.string()
  .refine((value) => Array.from(value).length >= 8, "密码至少 8 位。")
  .refine((value) => Array.from(value).length <= 128, "密码不能超过 128 位。")
  .refine((value) => /[A-Z]/.test(value), "密码至少包含一个大写英文字母。")
  .refine((value) => /[!-/:-@[-`{-~]/.test(value), "密码至少包含一个特殊符号（如 !、@、#）。")
  .refine((value) => new TextEncoder().encode(value).byteLength <= 72, "新密码最多 72 个 UTF-8 字节。");
const scheduleVersion = z.literal(SCHEDULE_VERSION, { error: "时段已更新，请刷新页面后重试。" });

export const registerSchema = z.object({
  username,
  password,
}).strict();

export const loginSchema = z.object({
  username,
  password: z.string().min(1, "请填写密码。").max(128, "密码不能超过 128 位。"),
}).strict();

export const forgotPasswordSchema = z.object({ username }).strict();

export const accountProfileSchema = z.object({
  display_name: z.string().trim().max(30, "昵称最多 30 字。"),
}).strict();

export const selfPasswordChangeSchema = z.object({
  current_password: z.string().max(128).optional(),
  new_password: password,
  confirm_password: z.string().max(128),
}).strict().superRefine((input, context) => {
  if (input.new_password !== input.confirm_password) {
    context.addIssue({ code: "custom", path: ["confirm_password"], message: "两次输入的新密码不一致。" });
  }
  if (input.current_password !== undefined && input.new_password === input.current_password) {
    context.addIssue({ code: "custom", path: ["new_password"], message: "新密码不能与当前密码相同。" });
  }
});

const markInputSchema = z.object({
  day_index: z.number().int().min(0).max(6),
  slot_index: z.number().int().min(0).max(SLOT_COUNT - 1),
  nickname: z.string().trim().min(1, "请填写昵称。").max(30, "昵称最多 30 字。"),
  location: z.string().trim().max(100, "场地最多 100 字。").optional().default(""),
}).strict();

const markCoordinatesSchema = z.object({
  day_index: z.number().int().min(0).max(6),
  slot_index: z.number().int().min(0).max(SLOT_COUNT - 1),
}).strict();

const markNoteSchema = z.string().trim().max(200, "备注最多 200 字。").optional();
const markWeekFields = {
  week_key: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  schedule_version: scheduleVersion,
  note: markNoteSchema,
};

const uniqueMarks = <T extends { day_index: number; slot_index: number }>(items: T[], context: z.RefinementCtx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = item.day_index + "-" + item.slot_index;
    if (seen.has(key)) context.addIssue({ code: "custom", path: ["items", index], message: "同一格不能重复提交。" });
    seen.add(key);
  });
};

const legacyMarksWriteSchema = z.object({
  ...markWeekFields,
  items: z.array(markInputSchema).min(1).max(WEEK_CELL_COUNT),
}).strict().superRefine((input, context) => uniqueMarks(input.items, context));

const sharedMarksWriteSchema = z.object({
  ...markWeekFields,
  nickname: z.string().trim().min(1, "请填写昵称。").max(30, "昵称最多 30 字。"),
  location: z.string().trim().max(100, "场地最多 100 字。"),
  items: z.array(markCoordinatesSchema).min(1).max(WEEK_CELL_COUNT),
}).strict().superRefine((input, context) => uniqueMarks(input.items, context));

const normalizedMarksWriteSchema = z.object({
  ...markWeekFields,
  items: z.array(markInputSchema).min(1).max(WEEK_CELL_COUNT),
}).strict();

export const marksWriteSchema = z.preprocess((value, context) => {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  const shared = Boolean(record && ("nickname" in record || "location" in record));
  const parsed = (shared ? sharedMarksWriteSchema : legacyMarksWriteSchema).safeParse(value);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => context.addIssue({ code: "custom", path: issue.path, message: issue.message }));
    return z.NEVER;
  }
  if ("nickname" in parsed.data) {
    const { nickname, location, ...common } = parsed.data;
    return { ...common, items: parsed.data.items.map((item) => ({ ...item, nickname, location })) };
  }
  return parsed.data;
}, normalizedMarksWriteSchema);

export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["ban", "unban", "delete", "restore", "promote_admin", "demote_admin"]), reason: z.string().trim().min(4).max(300) }).strict(),
  z.object({ action: z.literal("reset_password"), reason: z.string().trim().min(4).max(300), password }).strict(),
  z.object({ action: z.literal("reset_default_password"), reason: z.string().trim().min(4).max(300) }).strict(),
]);

export const resetRequestActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss") }).strict(),
  z.object({ action: z.literal("reset_default_password"), reason: z.string().trim().min(4).max(300) }).strict(),
]);

export const adminMarksActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clear_week"), week_key: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/), reason: z.string().trim().min(4).max(300) }).strict(),
  z.object({ action: z.enum(["delete_marks", "restore_marks"]), week_key: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/), mark_ids: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().min(4).max(300) }).strict(),
]);

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MarkInput = z.infer<typeof markInputSchema>;
