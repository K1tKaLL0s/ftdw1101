export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryAfter?: number; fieldErrors?: Record<string, string[]> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryAfter = options.retryAfter;
    this.fieldErrors = options.fieldErrors;
  }
}

export function fromDatabaseError(code: string | undefined, message: string): AppError {
  if (message.includes("late entry unsupported format")) {
    return new AppError(409, "late_entry_unsupported", "开赛后补录仅支持三幻神随机赛；瑞士轮和固定签表不能安全追加选手。");
  }
  if (message.includes("late entry window closed")) {
    return new AppError(409, "late_entry_closed", "当前组已停止匹配、已开启复活或名次处理，或总时限已到，不能再补录入池。");
  }
  if (message.includes("late entry only on event day")) {
    return new AppError(409, "event_day_only", "开赛后补录仅在赛事当地日期当天开放。");
  }
  if (message.includes("invalid late entry configuration")) {
    return new AppError(422, "invalid_late_entry", "请明确选择初始幻神或初始无卡，以及当前可加入的分组。");
  }
  if (message.includes("late entry already checked in or withdrawn") || message.includes("late entry already in pool")) {
    return new AppError(409, "late_entry_exists", "该选手已报到入池或已退赛，请刷新名单，不要重复补录。");
  }
  if (message.includes("duplicate entry name")) {
    return new AppError(409, "duplicate_entry", "同名选手已有报名，请在名单中确认报到；不同选手请使用可区分的昵称。");
  }
  if (message.includes("onsite registration only on event day")) {
    return new AppError(409, "event_day_only", "现场补录仅在赛事当地日期当天、锁定选手池前开放。");
  }
  if (message.includes("registration locked after start")) {
    return new AppError(409, "registration_locked", "赛事已锁定选手池或结束，不能再修改预报名时间或现场补录。");
  }
  if (message.includes("deadline must not be later than start")) {
    return new AppError(422, "invalid_deadline", "预报名截止不能晚于开赛时间。");
  }
  if (message === "full") {
    return new AppError(409, "tournament_full", "报名人数已达上限，不能继续报名或补录。");
  }
  if (message.toLowerCase().includes("schedule version mismatch")) {
    return new AppError(422, "schedule_version_mismatch", "时段已更新，请刷新页面后重试。");
  }
  if (message.toLowerCase().includes("device account quota")) {
    return new AppError(409, "device_limit", "此浏览器已达到两个账号的注册上限。");
  }
  if (message.toLowerCase().includes("duplicate key")) {
    return new AppError(409, "conflict", "该用户名已被占用，或这条登记已存在。");
  }
  switch (code) {
    case "28000":
      return new AppError(401, "unauthenticated", "登录状态已失效，请重新登录。");
    case "42501":
      return new AppError(403, "forbidden", "没有权限执行此操作。");
    case "22023":
      return new AppError(422, "invalid_request", "提交内容无效或超出允许范围。");
    case "23505":
    case "23514":
    case "40001":
      return new AppError(409, "conflict", "当前状态已变化，请刷新后重试。");
    case "P0002":
      return new AppError(404, "not_found", "找不到这条记录。");
    default:
      return new AppError(503, "service_unavailable", "服务暂时不可用，请稍后重试。");
  }
}

export function invalidFields(fieldErrors: Record<string, string[]>): AppError {
  return new AppError(422, "validation_failed", "请检查标记的输入项。", { fieldErrors });
}
