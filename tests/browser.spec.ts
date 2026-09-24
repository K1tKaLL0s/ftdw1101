import { expect, test, type Page, type Route } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { SLOT_COUNT, WEEK_CELL_COUNT, SCHEDULE_VERSION } from "../lib/schedule";

type Slot = { dayIndex: number; slotIndex: number; count: number; mine: boolean };
const user = { id: "11111111-1111-4111-8111-111111111111", username: "player_01", isAdmin: false };
const admin = { id: "22222222-2222-4222-8222-222222222222", username: "admin_01", isAdmin: true };
const ok = (data: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(data) });
const emptySlots = (): Slot[] => Array.from({ length: WEEK_CELL_COUNT }, (_, index) => ({ dayIndex: Math.floor(index / SLOT_COUNT), slotIndex: index % SLOT_COUNT, count: 0, mine: false }));

async function mockHome(page: Page, options: { detailCounts?: boolean; serverTime?: () => string; onSave?: (route: Route, count: number) => Promise<void> } = {}) {
  const serverTime = () => options.serverTime?.() ?? new Date().toISOString();
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user, serverTime: serverTime() })));
  let saves = 0;
  await page.route("**/api/marks?*", (route) => {
    const slots = emptySlots();
    if (options.detailCounts) { slots[0].count = 1; slots[SLOT_COUNT].count = 1; }
    return route.fulfill(ok({ weekKey: new URL(route.request().url()).searchParams.get("week"), slots, serverTime: serverTime() }));
  });
  await page.route("**/api/marks", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill(ok({ error: "unexpected" }, 405));
    saves += 1;
    if (options.onSave) return options.onSave(route, saves);
    return route.fulfill(ok({ accepted: 1, changed: 1 }));
  });
  await page.route("**/api/auth/logout", (route) => route.fulfill(ok({ error: { message: "logout temporarily unavailable" } }, 503)));
}

function shiftWeek(week: string, offset: number): string {
  const date = new Date(`${week}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset * 7);
  return date.toISOString().slice(0, 10);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("password reset inbox pagination survives a quiet refresh takeover", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-25T00:00:00.000Z") });
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user: admin })));
  const firstNextStarted = deferred();
  const releaseFirstNext = deferred();
  const cursors: Array<string | null> = [];
  let nextRequests = 0;
  const first = { id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", user_id: "33333333-3333-4333-8333-333333333333", username: "member_01", status: "active", requested_at: "2026-09-24T00:00:00.000Z" };
  const last = { ...first, id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2", username: "member_31" };
  await page.route("**/api/admin/password-reset-requests**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (!cursor) return route.fulfill(ok({ items: [first], total: 31, nextCursor: "cursor-30" }));
    nextRequests += 1;
    if (nextRequests === 1) {
      firstNextStarted.resolve();
      await releaseFirstNext.promise;
      try { await route.fulfill(ok({ items: [last], total: 31, nextCursor: null })); } catch { /* A newer refresh may have won the race. */ }
      return;
    }
    return route.fulfill(ok({ items: [last], total: 31, nextCursor: null }));
  });

  await page.goto("/admin/password-reset-requests");
  await expect(page.getByText("member_01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await firstNextStarted.promise;
  await expect(page.getByText("正在加载…")).toBeVisible();
  await page.clock.fastForward("00:00:30");
  await expect(page.getByText("member_31", { exact: true })).toBeVisible();
  await expect(page.getByText("正在加载…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "第一页" })).toBeEnabled();
  await page.clock.fastForward(100);
  await expect(page.getByText("member_31", { exact: true })).toBeVisible();
  expect(cursors).toEqual([null, "cursor-30", "cursor-30"]);
  releaseFirstNext.resolve();
  await page.clock.fastForward(100);
  await expect(page.getByText("member_31", { exact: true })).toBeVisible();
});

test("mark notes stay plain text and the registration controls align without responsive overflow", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-09-25T10:00:00.000Z") });
  let submitted: Record<string, unknown> | undefined;
  await mockHome(page, { detailCounts: true, serverTime: () => "2026-09-25T10:00:00.000Z", onSave: async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill(ok({ accepted: 1, changed: 1 }));
  } });
  await page.route("**/api/marks?*", (route) => {
    const slots = emptySlots().map((slot) => ({ ...slot, preview: [] as Array<{ user_id: string; nickname: string; avatar_version: number }> }));
    slots[0].count = 1;
    slots[0].mine = true;
    slots[0].preview = [{ user_id: user.id, nickname: "预约者姓名预约者姓名预约者姓名预约者姓名预约者姓名预约者姓名", avatar_version: 0 }];
    return route.fulfill(ok({ weekKey: new URL(route.request().url()).searchParams.get("week"), slots, serverTime: "2026-09-25T10:00:00.000Z" }));
  });
  await page.route(`**/api/users/${user.id}?*`, (route) => route.fulfill(ok({
    user: { id: user.id, display_name: "公开昵称", avatar_version: 0 }, week_key: "2026-09-21", items: [{
      id: "88888888-8888-4888-8888-888888888888", day_index: 0, slot_index: 0, nickname: "小林", location: "场地 A", note,
      created_at: "2026-09-24T00:00:00.000000+00:00",
    }],
  })));
  const note = '<img src=x onerror="alert(1)">\n第二行';
  await page.route("**/api/marks/details?*", (route) => route.fulfill(ok({ items: [{
    id: "77777777-7777-4777-8777-777777777777", user_id: user.id, nickname: "小林", location: "场地 A", note,
    avatar_version: 0, created_at: "2026-09-24T00:00:00.000000+00:00",
  }], total: 1, nextCursor: null })));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "填写登记" })).toBeVisible();
  await page.getByRole("button", { name: "选择时段" }).first().click();
  await page.getByLabel("登记昵称").fill("小林");
  await page.getByLabel("备注 （选填，最多 200 字）").fill(note);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("登记昵称")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const nickname = document.querySelector<HTMLInputElement>("#nickname")!.getBoundingClientRect();
      const location = document.querySelector<HTMLInputElement>("#location")!.getBoundingClientRect();
      const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "保存登记")!.getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, viewport: window.innerWidth, nicknameBottom: nickname.bottom, locationBottom: location.bottom, saveBottom: save.bottom, saveHeight: save.height };
    });
    expect(geometry.width).toBe(width);
    if (width >= 768) {
      expect(Math.abs(geometry.nicknameBottom - geometry.locationBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.locationBottom - geometry.saveBottom)).toBeLessThanOrEqual(1);
      const rowButtons = await page.getByRole("table", { name: "本周七天五个时段登记表" }).locator("tbody tr").first().locator("button[aria-pressed]").evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      }));
      expect(rowButtons).toHaveLength(7);
      expect(Math.max(...rowButtons.map((rect) => rect.height))).toBeGreaterThanOrEqual(44);
      expect(Math.max(...rowButtons.map((rect) => rect.bottom)) - Math.min(...rowButtons.map((rect) => rect.bottom))).toBeLessThanOrEqual(1);
    } else {
      expect(geometry.saveHeight).toBeGreaterThanOrEqual(44);
      const cards = page.locator('section[aria-label="每周可预约时间"] article');
      await expect(cards).toHaveCount(5);
      await expect(cards.filter({ hasText: "17:00–20:00" }).getByText("当前时段", { exact: true })).toBeVisible();
      const cardGeometry = await cards.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        return { height: rect.height, buttonHeight: buttons.map((button) => button.height), buttonBottom: buttons.map((button) => button.bottom) };
      }));
      expect(Math.max(...cardGeometry.map((rect) => rect.height)) - Math.min(...cardGeometry.map((rect) => rect.height))).toBeLessThanOrEqual(1);
      for (const card of cardGeometry) {
        expect(card.buttonHeight.every((height) => height >= 44)).toBe(true);
        expect(Math.abs(card.buttonBottom[0] - card.buttonBottom[1])).toBeLessThanOrEqual(1);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`marks-note-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "保存登记" }).click();
  await expect(page.getByRole("status")).toContainText("已保存 1 条登记");
  expect(submitted?.note).toBe(note);
  expect((submitted?.items as Array<Record<string, unknown>>).every((item) => !("note" in item) && !("nickname" in item) && !("location" in item))).toBe(true);
  await page.getByRole("button", { name: /周一 08:00–11:00.*查看详情/ }).click();
  const detail = page.getByRole("dialog");
  await expect(detail.locator("p").filter({ hasText: note })).toBeVisible();
  await expect(detail.locator('img[src="x"]')).toHaveCount(0);
  await detail.getByRole("link", { name: "查看小林的用户资料" }).click();
  await expect(page.getByRole("heading", { name: "公开昵称" })).toBeVisible();
  await expect(page.getByText("2026-09-21 至 2026-09-27")).toBeVisible();
  await expect(page.locator("main").getByText(note)).toBeVisible();
});

test("one-time recovery password change shows only the two new-password fields", async ({ page }) => {
  const recoveryUser = { ...user, mustChangePassword: false, canChangePasswordWithoutCurrent: true, displayName: "牌友", avatarVersion: 0 };
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user: recoveryUser, serverTime: "2026-09-25T12:00:00.000Z" })));
  await page.route("**/api/account", (route) => route.fulfill(ok({ profile: { id: user.id, username: user.username, display_name: "牌友", avatar_version: 0, role: "user", must_change_password: false } })));
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/account/password", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill(ok({ ok: true, reauthenticationRequired: true }));
  });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
  await expect(page.getByLabel("当前密码")).toHaveCount(0);
  await expect(page.getByText(/新密码至少 8 位，包含一个大写英文字母和特殊符号/).first()).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("Aaaaaaaa!");
  await page.getByLabel("确认新密码").fill("Aaaaaaaa!");
  await page.getByRole("button", { name: "更新密码并重新登录" }).click();
  await expect(page).toHaveURL(/\/login\?changed=1/);
  expect(submitted).toEqual({ new_password: "Aaaaaaaa!", confirm_password: "Aaaaaaaa!" });
});

test("ordinary password change still requires and submits the current password", async ({ page }) => {
  const ordinaryUser = { ...user, mustChangePassword: false, canChangePasswordWithoutCurrent: false, displayName: "牌友", avatarVersion: 0 };
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user: ordinaryUser, serverTime: "2026-09-25T12:00:00.000Z" })));
  await page.route("**/api/account", (route) => route.fulfill(ok({ profile: { id: user.id, username: user.username, display_name: "牌友", avatar_version: 0, role: "user", must_change_password: false } })));
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/account/password", async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill(ok({ error: { code: "invalid_fields", message: "密码更新未完成。", fields: { current_password: ["当前密码验证失败"] } } }, 422));
  });
  await page.goto("/account");
  await page.getByRole("button", { name: "账号安全" }).click();
  await expect(page.getByLabel("当前密码")).toBeVisible();
  await page.getByLabel("当前密码").fill("OldPass!");
  await page.getByLabel("新密码", { exact: true }).fill("Aaaaaaaa!");
  await page.getByLabel("确认新密码").fill("Aaaaaaaa!");
  await page.getByRole("button", { name: "更新密码并重新登录" }).click();
  await expect(page.locator("main > p[role=\"alert\"]")).toContainText("当前密码验证失败");
  expect(submitted).toEqual({ current_password: "OldPass!", new_password: "Aaaaaaaa!", confirm_password: "Aaaaaaaa!" });
});

test("registration shows Unicode-codepoint and backend field errors without exposing contact details", async ({ page }) => {
  await page.route("**/api/auth/register", (route) => route.fulfill(ok({ error: { code: "invalid_fields", message: "注册信息无效。", fields: { password: ["模拟后端密码错误"] } } }, 422)));
  await page.goto("/login");
  await page.getByRole("button", { name: "还没有账号？创建一个" }).click();
  await page.getByLabel("用户名").fill("guest_01");
  await page.getByLabel("密码").fill("A!😀😀😀");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByText("密码至少 8 位。", { exact: true })).toBeVisible();

  await page.getByLabel("密码").fill("A!😀😀😀😀😀😀");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByText("模拟后端密码错误", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/);
  await expect(page.locator("body")).not.toContainText(/\b\d{7,}\b/);
});

test("home retains failed entry values, saves a blank location, and stays signed in after logout failure", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await mockHome(page, { serverTime: () => "2026-09-21T04:00:00.000Z", onSave: async (route, count) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    if (count === 1) return route.fulfill(ok({ error: { code: "invalid_fields", message: "登记有误。", fields: { items: ["场地格式需要调整"] } } }, 422));
    return route.fulfill(ok({ accepted: 1, changed: 1 }));
  } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "填写登记" })).toBeVisible();
  await page.getByRole("button", { name: "选择时段" }).first().click();
  await page.getByLabel("登记昵称").fill("小林");
  await page.getByLabel(/所在场地/).fill("");
  await page.getByRole("button", { name: "保存登记" }).click();
  await expect(page.locator("main > p[role=alert]")).toContainText("场地格式需要调整");
  await expect(page.getByLabel("登记昵称")).toHaveValue("小林");
  await expect(page.getByRole("button", { name: "已选择" })).toBeVisible();
  await page.getByRole("button", { name: "保存登记" }).click();
  await expect(page.getByRole("status")).toContainText("已保存 1 条登记");
  const items = submitted?.items as Array<{ day_index: number; slot_index: number }>;
  expect(submitted).toMatchObject({ nickname: "小林", location: "" });
  expect(items[0]).toEqual({ day_index: 0, slot_index: 0 });
  expect(submitted?.schedule_version).toBe(SCHEDULE_VERSION);
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page.locator("main > p[role=alert]")).toContainText("logout temporarily unavailable");
  await expect(page.getByText("player_01", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("Shanghai schedule clock follows midnight, the new week, and the 08:00 slot after foregrounding", async ({ page }) => {
  let serverNow = new Date("2026-09-27T15:59:00.000Z");
  await page.clock.install({ time: serverNow });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHome(page, { serverTime: () => serverNow.toISOString() });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "填写登记" })).toBeVisible();
  await expect(page.getByText("北京时间 2026-09-27 23:59:00", { exact: true })).toBeVisible();
  await expect(page.getByText(/2026-09-21 至 2026-09-27/)).toBeVisible();
  await expect(page.locator('button[aria-pressed="true"]').filter({ hasText: "周日" })).toBeVisible();
  await expect(page.getByText("当前时段", { exact: true }).filter({ visible: true })).toHaveCount(0);

  serverNow = new Date("2026-09-27T16:00:00.000Z");
  await page.clock.fastForward("00:01:00");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("北京时间 2026-09-28 00:00:00", { exact: true })).toBeVisible();
  await expect(page.getByText(/2026-09-28 至 2026-10-04/)).toBeVisible();
  await expect(page.locator('button[aria-pressed="true"]').filter({ hasText: "周一" })).toBeVisible();

  await page.getByRole("button", { name: "上一周" }).click();
  await expect(page.getByText(/2026-09-21 至 2026-09-27/)).toBeVisible();

  serverNow = new Date("2026-10-04T16:00:00.000Z");
  await page.clock.setFixedTime(serverNow);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("北京时间 2026-10-05 00:00:00", { exact: true })).toBeVisible();
  await expect(page.getByText(/2026-09-21 至 2026-09-27/)).toBeVisible();
  await page.getByRole("button", { name: "回到本周" }).click();
  await expect(page.getByText(/2026-10-05 至 2026-10-11/)).toBeVisible();

  serverNow = new Date("2026-10-04T23:59:00.000Z");
  await page.clock.setFixedTime(serverNow);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("北京时间 2026-10-05 07:59:00", { exact: true })).toBeVisible();
  await expect(page.getByText("当前时段", { exact: true }).filter({ visible: true })).toHaveCount(0);

  serverNow = new Date("2026-10-05T00:00:00.000Z");
  await page.clock.fastForward("00:01:00");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("北京时间 2026-10-05 08:00:00", { exact: true })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "08:00–11:00" }).getByText("当前时段", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("delayed prior-week and prior-cell responses do not replace current view", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user })));
  const hold = deferred();
  const oldWeekStarted = deferred();
  const firstCellStarted = deferred();
  let currentWeek = "";
  let heldWeek = "";
  await page.route("**/api/marks?*", async (route) => {
    const requested = new URL(route.request().url()).searchParams.get("week") ?? "";
    if (requested === heldWeek && heldWeek) {
      oldWeekStarted.resolve();
      await hold.promise;
    }
    const slots = emptySlots();
    slots[0].count = 1; slots[SLOT_COUNT].count = 1;
    try { await route.fulfill(ok({ weekKey: requested, slots })); } catch { /* The page may have aborted the stale request. */ }
  });
  await page.route("**/api/marks/details?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const day = params.get("day");
    if (day === "0") {
      firstCellStarted.resolve();
      await holdCell.promise;
    }
    try {
      await route.fulfill(ok({ items: [{ id: day === "1" ? "66666666-6666-4666-8666-666666666666" : "77777777-7777-4777-8777-777777777777", user_id: user.id, nickname: day === "1" ? "周二登记" : "周一登记", location: "皆可", created_at: "2026-09-24T00:00:00.000000+00:00" }], total: 1, nextCursor: null }));
    } catch { /* An aborted stale request is expected in this test. */ }
  });
  const holdCell = deferred();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "填写登记" })).toBeVisible();
  const range = await page.getByText(/Asia\/Shanghai 周一开始/).innerText();
  currentWeek = range.slice(0, 10);
  heldWeek = shiftWeek(currentWeek, -1);
  await page.getByRole("button", { name: "上一周" }).click();
  await oldWeekStarted.promise;
  await page.getByRole("button", { name: "回到本周" }).click();
  await expect(page.getByText(new RegExp(`${currentWeek} 至`))).toBeVisible();
  hold.resolve();
  await expect(page.getByText(new RegExp(`${currentWeek} 至`))).toBeVisible();
  await page.getByRole("button", { name: /周一 08:00–11:00.*查看详情/ }).click();
  await firstCellStarted.promise;
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: /周二 08:00–11:00.*查看详情/ }).click();
  await expect(page.getByRole("heading", { name: /周二.*登记详情/ })).toBeVisible();
  holdCell.resolve();
  await expect(page.getByRole("heading", { name: /周二.*登记详情/ })).toBeVisible();
});

test("admin reset dialog displays backend errors, clears secrets on cancel, and returns focus", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user: admin })));
  const target = { id: "33333333-3333-4333-8333-333333333333", username: "member_01", role: "user", status: "active", created_at: "2026-09-24T00:00:00Z", deleted_at: null, active_marks: 2 };
  await page.route("**/api/admin/users**", (route) => route.fulfill(ok({ items: [target], total: 1, nextCursor: null })));
  await page.route("**/api/admin/audit**", (route) => route.fulfill(ok({ items: [], total: 0, nextCursor: null })));
  await page.route("**/api/admin/users/*", (route) => route.fulfill(ok({ error: { code: "invalid_fields", message: "新密码不符合要求。", fields: { password: ["需要大写字母和特殊符号"] } } }, 422)));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理员", exact: true })).toBeVisible();
  const resetButton = page.getByRole("button", { name: "手动重置密码" });
  await resetButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("A!123456");
  await page.getByLabel("操作原因（必填）").fill("用户申请重置");
  await page.getByRole("button", { name: "确认手动重置密码" }).click();
  await expect(dialog.getByRole("alert")).toContainText("需要大写字母和特殊符号");
  await dialog.getByRole("button", { name: "关闭确认框" }).click();
  await expect(resetButton).toBeFocused();
  await resetButton.click();
  await expect(page.getByLabel("新密码", { exact: true })).toHaveValue("");
});

test("admin restores a record on page two after more than 30 deleted records", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill(ok({ user: admin })));
  await page.route("**/api/admin/marks?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const state = params.get("state");
    const cursor = params.get("cursor");
    if (state === "active") return route.fulfill(ok({ items: [], total: 0, activeCount: 0, nextCursor: null, state }));
    if (!cursor) {
      const items = Array.from({ length: 30 }, (_, i) => ({ id: `44444444-4444-4444-8444-${String(i + 1).padStart(12, "0")}`, user_id: user.id, username: user.username, day_index: 0, slot_index: 0, nickname: `已删除登记 ${i + 1}`, location: "皆可", created_at: "2026-09-24T00:00:00.000001+00:00", deleted_at: "2026-09-24T01:00:00+00:00" }));
      return route.fulfill(ok({ items, total: 31, activeCount: 0, nextCursor: "cursor-30", state }));
    }
    const item = { id: "55555555-5555-4555-8555-555555555555", user_id: user.id, username: user.username, day_index: 0, slot_index: 1, nickname: "最后一条登记", location: "皆可", created_at: "2026-09-24T00:00:00.000000+00:00", deleted_at: "2026-09-24T01:00:00+00:00" };
    return route.fulfill(ok({ items: [item], total: 31, activeCount: 0, nextCursor: null, state }));
  });
  let restoreIds: string[] = [];
  await page.route("**/api/admin/marks", async (route) => {
    const data = route.request().postDataJSON() as { action: string; mark_ids: string[] };
    restoreIds = data.mark_ids;
    return route.fulfill(ok({ affected: 1 }));
  });
  await page.goto("/admin/marks");
  await expect(page.getByRole("heading", { name: "登记管理" })).toBeVisible();
  await page.getByRole("button", { name: "已删除", exact: true }).click();
  await expect(page.getByText("已删除登记 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("最后一条登记", { exact: true })).toBeVisible();
  await page.locator("label").filter({ hasText: "最后一条登记" }).locator("input").check();
  await page.getByRole("button", { name: "恢复所选登记" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("操作原因").fill("用户登记遗漏恢复");
  await page.getByRole("button", { name: "确认处理 1 条" }).click();
  await expect(page.getByRole("status")).toContainText("实际影响 1 条登记");
  expect(restoreIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
});

test("real Next HTTP handlers enforce origin, body size, authentication, cookies and CSP", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  const cspNonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  expect(cspNonce).toBeTruthy();
  const html = await response.text();
  const scriptTags = html.match(/<script\b/gi) ?? [];
  const scriptNonces = [...html.matchAll(/<script\b[^>]*\bnonce="([^"]+)"/gi)].map((match) => match[1]);
  expect(scriptNonces).toHaveLength(scriptTags.length);
  expect(new Set(scriptNonces)).toEqual(new Set([cspNonce]));
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");

  const repeatedPage = await request.get("/");
  const repeatedCsp = repeatedPage.headers()["content-security-policy"] ?? "";
  const repeatedNonce = repeatedCsp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  expect(repeatedPage.status()).toBe(200);
  expect(repeatedNonce).toBeTruthy();
  expect(repeatedNonce).not.toBe(cspNonce);

  const badOrigin = await request.post("/api/auth/register", { headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, data: "{}" });
  expect(badOrigin.status()).toBe(403);
  const wrongType = await request.post("/api/auth/register", { headers: { origin: "http://127.0.0.1:3400", "content-type": "text/plain" }, data: "{}" });
  expect(wrongType.status()).toBe(415);
  const tooLarge = await request.post("/api/auth/register", { headers: { origin: "http://127.0.0.1:3400", "content-type": "application/json" }, data: JSON.stringify({ payload: "x".repeat(17_000) }) });
  expect(tooLarge.status()).toBe(413);
  const privateRead = await request.get("/api/marks?week=2026-09-21");
  expect(privateRead.status()).toBe(401);
  const adminRead = await request.get("/api/admin/users");
  expect(adminRead.status()).toBe(401);
  const defaultAvatar = await request.get("/default-avatar.svg");
  expect(defaultAvatar.status()).toBe(200);
  expect(await defaultAvatar.text()).toContain("来牌");
  const session = await request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect(session.headers()["cache-control"]).toContain("no-store");
  expect((await session.json()).user).toBeNull();
  expect(session.headers()["set-cookie"]).toContain("HttpOnly");
});

test("the live BFF rejects must-change sessions before calling any business RPC", async ({ request }) => {
  const rpcCalls: string[] = [];
  const fakeSupabase = createServer((incoming, response) => {
    const path = new URL(incoming.url ?? "/", "http://localhost").pathname;
    const rpcName = path.split("/").at(-1) ?? "";
    rpcCalls.push(rpcName);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(rpcName === "app_get_session_context" ? [{
      user_id: admin.id,
      username: admin.username,
      is_admin: true,
      auth_email: "admin@example.invalid",
      auth_epoch: 3,
      must_change_password: true,
      display_name: "",
      avatar_version: 0,
      can_change_password_without_current: false,
      expires_at: "2099-01-01T00:00:00.000Z",
    }] : []));
  });
  fakeSupabase.listen(54321, "localhost");
  await once(fakeSupabase, "listening");
  try {
    const cookie = `lai_pai_session=${"S".repeat(43)}`;
    for (const path of ["/api/marks?week=2026-09-21", "/api/admin/users"]) {
      const response = await request.get(path, { headers: { cookie } });
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe("password_change_required");
    }
    expect(rpcCalls).toEqual(["app_get_session_context", "app_get_session_context"]);
  } finally {
    await new Promise<void>((resolve, reject) => fakeSupabase.close((error) => error ? reject(error) : resolve()));
  }
});
