import { expect, test, type Page } from "@playwright/test";
import { advanceToCut, nextSwissRound, recordResult, startTournament } from "../lib/tournaments/engine";
import { getCurrentWeekKey, shiftDayKey } from "../lib/week";
import type { Tournament, TournamentDetail } from "../lib/tournaments/types";

const eventId = "10000000-0000-4000-8000-000000000001";
const entryId = (i: number) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const user = { id: "30000000-0000-4000-8000-000000000001", username: "普通发布者", isAdmin: false };
const ok = (data: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(data) });
function tournament(change: Partial<Tournament> = {}): Tournament {
  return { id: eventId, title: "周六校园杯", description: "来牌校赛", location: "学生活动室", timezone: "Asia/Shanghai", capacity: 16,
    starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), registration_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    format: "swiss_cut", swiss_rounds: 3, top_cut: 4, tie_break_policy: "完全同分时现场公开抽签，并记录结果。", extra_rules: "请提前到场。",
    status: "published", revision: 0, state: null, special_grouping: "single", special_state: null, created_at: new Date().toISOString(), entry_count: 0, checked_in_count: 0, ...change };
}
async function mockDetail(page: Page, current: TournamentDetail, mutate?: (input: Record<string, unknown>) => void) {
  await page.route(`**/api/tournaments/${eventId}`, async route => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      try { mutate?.(input); current.tournament.revision++; return route.fulfill(ok({ ok: true })); }
      catch (error) { return route.fulfill(ok({ error: { code: "tournament_rules", message: (error as Error).message } }, 409)); }
    }
    return route.fulfill(ok(current));
  });
}

test("ordinary users see both event and casual booking in the same desktop/mobile calendar with filters", async ({ page }, info) => {
  const week = getCurrentWeekKey(); const t = tournament({ starts_at: `${shiftDayKey(week, 5)}T05:30:00Z`, entry_count: 8, checked_in_count: 0 });
  await page.route("**/api/auth/session", route => route.fulfill(ok({ user, serverTime: new Date().toISOString() })));
  await page.route("**/api/marks?*", route => route.fulfill(ok({ weekKey: week, serverTime: new Date().toISOString(), slots: Array.from({ length: 35 }, (_, i) => ({ dayIndex: Math.floor(i / 5), slotIndex: i % 5, count: i === 26 ? 2 : 0, mine: false, preview: [] })) })));
  const early = tournament({ id: "50000000-0000-4000-8000-000000000099", title: "晨间校赛", starts_at: `${shiftDayKey(week, 5)}T08:30:00+09:00` });
  await page.route("**/api/tournaments?*", route => route.fulfill(ok({ items: [t, early], nextOffset: null })));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/schedule");
  await expect(page.getByRole("link", { name: "发布赛事", exact: true })).toBeVisible();
  await expect(page.locator("table").getByRole("link", { name: /赛事 · 周六校园杯/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "本周七天五个时段登记表" })).toBeVisible();
  await expect(page.locator("table").getByRole("link", { name: /赛事 · 晨间校赛/ })).toContainText("预约时段外");
  await expect(page.locator('nav[aria-label="账户导航"] a[href="/account"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "选择时段", exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("calendar-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "普通约牌", exact: true }).click();
  await expect(page.locator("table").getByRole("link", { name: /赛事 · 周六校园杯/ })).toHaveCount(0);
  await page.getByRole("button", { name: "赛事", exact: true }).click();
  await expect(page.getByRole("button", { name: "选择时段", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /周六/ }).click();
  await expect(page.getByRole("link", { name: /赛事 · 周六校园杯/ }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: info.outputPath("calendar-mobile.png"), fullPage: true });
});

test("creation enforces 25 perceived characters and publishes the chosen two-stage format", async ({ page }, info) => {
  let submitted: Record<string, unknown> | undefined;
  const data: TournamentDetail = { tournament: tournament(), entrants: [], mine: null, canManage: true };
  await mockDetail(page, data);
  await page.route("**/api/tournaments", async route => {
    submitted = route.request().postDataJSON(); Object.assign(data.tournament, submitted); return route.fulfill(ok({ id: eventId }, 201));
  });
  await page.goto("/tournaments/new");
  const title = page.getByLabel("赛事名称");
  await title.fill("🃏".repeat(26));
  await expect(page.getByText(/26\/25 字/)).toBeVisible();
  await expect(page.getByRole("button", { name: "发布并开放预报名" })).toBeDisabled();
  await title.fill(" 校园杯🃏 ");
  await expect(page.getByText(/4\/25 字/)).toBeVisible();
  await page.getByLabel("举办地点").fill("学生活动室");
  await page.getByLabel("举办日期与时间").fill("2099-10-24T13:30");
  await page.getByLabel("预报名截止").fill("2099-10-24T12:30");
  await page.getByLabel("瑞士轮轮数").selectOption("5");
  await page.getByLabel("晋级人数").selectOption("8");
  await page.screenshot({ path: info.outputPath("create.png"), fullPage: true });
  await page.getByRole("button", { name: "发布并开放预报名" }).click();
  await expect(page.getByRole("heading", { name: "校园杯🃏", exact: true })).toBeVisible();
  expect(submitted).toMatchObject({ title: "校园杯🃏", swiss_rounds: 5, top_cut: 8, timezone: "Asia/Shanghai", format: "swiss_cut", starts_at: "2099-10-24T05:30:00.000Z" });
});

test("participant preregistration is separate from official check-in and exposes no organizer controls", async ({ page }) => {
  const data: TournamentDetail = { tournament: tournament(), entrants: [], mine: null, canManage: false }; let action = "";
  await mockDetail(page, data, input => { action = String(input.action); data.mine = entryId(1); data.entrants = [{ id: entryId(1), name: String(input.name), status: "preregistered" }]; data.tournament.entry_count = 1; });
  await page.goto(`/tournaments/${eventId}`);
  await page.getByLabel("参赛显示昵称").fill("参赛小甲");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "提交预报名" }).click();
  await expect(page.getByText(/你已预报名，等待当天报到/)).toBeVisible();
  expect(action).toBe("join");
  await expect(page.getByRole("button", { name: "确认正式报到" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "组织者操作" })).toHaveCount(0);
  await expect(page.getByText(/预报名总数 1\/16 · 已报到（未退赛）0/)).toBeVisible();
});

test("owner confirms event-day arrival; only checked-in entrants start a pseudo-double bracket", async ({ page }, info) => {
  const data: TournamentDetail = { tournament: tournament({ format: "pseudo_double", starts_at: new Date().toISOString(), entry_count: 3 }),
    entrants: [1, 2, 3].map(i => ({ id: entryId(i), name: `选手${i}`, status: "preregistered" })), mine: null, canManage: true };
  await mockDetail(page, data, input => {
    if (input.action === "checkin") { data.entrants.find(e => e.id === input.entryId)!.status = "checked_in"; data.tournament.checked_in_count++; }
    if (input.action === "start") { data.tournament.state = startTournament({ format: "pseudo_double", swissRounds: 3, topCut: 4 }, data.entrants.filter(e => e.status === "checked_in").map((e, i) => ({ id: e.id, name: e.name, seed: i + 1, active: true }))); data.tournament.status = "running"; }
  });
  await page.goto(`/tournaments/${eventId}`);
  await expect(page.getByRole("button", { name: "截止报名并正式开赛" })).toBeDisabled();
  await page.getByRole("button", { name: "确认正式报到" }).first().click();
  await expect(page.getByText(/预报名总数 3\/16 · 已报到（未退赛）1/)).toBeVisible();
  await page.getByRole("button", { name: "确认正式报到" }).first().click();
  await expect(page.getByText(/预报名总数 3\/16 · 已报到（未退赛）2/)).toBeVisible();
  await page.getByRole("checkbox", { name: /我已核对现场名单/ }).check();
  await page.getByRole("button", { name: "截止报名并正式开赛" }).click();
  await expect(page.getByRole("heading", { name: "胜者组", exact: true })).toBeVisible();
  expect(data.tournament.state!.entrants).toHaveLength(2);
  expect(data.tournament.state!.entrants.some(e => e.name === "选手3")).toBe(false);
  expect(data.tournament.state!.matches.filter(m => m.bracket === "final")).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "总决赛 · 单场无 reset" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("bracket.png"), fullPage: true });
});

test("Swiss tied qualification requires an explicit resolution before the seeded knockout", async ({ page }) => {
  let state = startTournament({ format: "swiss_cut", swissRounds: 3, topCut: 2 }, [1, 2, 3, 4].map(i => ({ id: entryId(i), name: `选手${i}`, seed: i, active: true })));
  for (let round = 1; round <= 3; round++) { for (const match of state.matches.filter(m => !m.result)) state = recordResult(state, match.id, "draw"); state = nextSwissRound({ format: "swiss_cut", swissRounds: 3, topCut: 2 }, state); }
  const data: TournamentDetail = { tournament: tournament({ status: "running", state, top_cut: 2, checked_in_count: 4, entry_count: 4 }), entrants: [1, 2, 3, 4].map(i => ({ id: entryId(i), name: `选手${i}`, status: "checked_in" })), mine: null, canManage: true };
  await mockDetail(page, data, input => { if (input.action === "cut") data.tournament.state = advanceToCut({ format: "swiss_cut", swissRounds: 3, topCut: 2 }, data.tournament.state!, input.orderedIds as string[] | undefined, String(input.reason ?? "")); });
  await page.goto(`/tournaments/${eventId}`); await page.getByRole("button", { name: "确认晋级并锁定淘汰签表" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("全同");
  await page.getByLabel(/处理后的完整顺序/).fill("3, 1, 4, 2"); await page.getByLabel("同分处理记录（公开）").fill("已按公布办法现场公开抽签");
  await page.getByRole("button", { name: "确认晋级并锁定淘汰签表" }).click();
  await expect(page.getByRole("heading", { name: "晋级单败淘汰赛" })).toBeVisible();
  const select = page.getByLabel("确认 K1-1 结果"); await expect(select.getByRole("option", { name: "平局" })).toHaveCount(0);
  expect(data.tournament.state!.cutSeeds).toEqual([entryId(3), entryId(1)]);
});

test("actual local API rejects missing sessions, forged origins and overlong titles", async ({ request, baseURL }) => {
  const unauthenticated = await request.get("/api/tournaments"); expect(unauthenticated.status()).toBe(401);
  const forged = await request.post("/api/tournaments", { headers: { Origin: "https://forged.invalid" }, data: {} }); expect(forged.status()).toBe(403);
  const invalidTitle = await request.post("/api/tournaments", { headers: { Origin: baseURL! }, data: { ...tournament(), title: "🃏".repeat(26), status: "published" } });
  expect(invalidTitle.status()).toBe(422); expect(JSON.stringify(await invalidTitle.json())).toContain("1–25");
});
