import { expect, test, type Page } from "@playwright/test";
import { applyThreeGodsCommand, specialRoster, type GodMatch, type GodOutcome, type ThreeGodsCommand, type ThreeGodsState } from "../lib/tournaments/three-gods";
import { manualSwissRound, nextSwissRound, recordResult, startTournament } from "../lib/tournaments/engine";
import type { TournamentDetail, Tournament } from "../lib/tournaments/types";
const eventId = "60000000-0000-4000-8000-000000000001";
const pid = (i: number) => `61000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ok = (data: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(data) });
const base = (change: Partial<Tournament> = {}): Tournament => ({ id: eventId, title: "三幻神校园杯", description: "校赛", location: "活动室", timezone: "Asia/Shanghai", format: "three_gods", special_grouping: "single", special_state: null,
  capacity: 16, starts_at: new Date().toISOString(), registration_deadline: new Date(Date.now() - 60_000).toISOString(), swiss_rounds: 3, top_cut: 2, tie_break_policy: "并列第一追加BO1，未决保持待裁判", extra_rules: "", status: "running", revision: 0, state: null, created_at: new Date().toISOString(), entry_count: 4, checked_in_count: 4, ...change });
async function mock(page: Page, data: TournamentDetail) {
  await page.route(`**/api/tournaments/${eventId}`, route => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      try {
        if (input.action === "special") data.tournament.special_state = applyThreeGodsCommand(data.tournament.special_state!, input.commandId, input.command, () => 0.75);
        if (input.action === "next_swiss") data.tournament.state = nextSwissRound({ format: "swiss_cut", swissRounds: 5, topCut: 2 }, data.tournament.state!);
        if (input.action === "manual_swiss") data.tournament.state = manualSwissRound({ format: "swiss_cut", swissRounds: 5, topCut: 2 }, data.tournament.state!, input.pairs, input.reason, input.allowRematches, input.allowRepeatBye);
        if (data.tournament.special_state?.phase === "complete") data.tournament.status = "completed";
        data.tournament.revision++; return route.fulfill(ok({ ok: true }));
      } catch (error) { return route.fulfill(ok({ error: { message: (error as Error).message, code: "rules" } }, 409)); }
    }
    return route.fulfill(ok(data));
  });
}
async function enterResult(page: Page, data: TournamentDetail, m: GodMatch, outcome: GodOutcome) {
  const card = page.getByTestId(`god-match-${m.id}`), before = data.tournament.special_state!.events.length;
  await card.getByText(m.result ? "查看更正影响 / 结果登记" : "登记小局与最终结果", { exact: true }).click();
  await card.getByLabel("A 小局胜", { exact: true }).fill(outcome === "a_win" ? String(m.bestOf === 1 ? 1 : 2) : "0");
  await card.getByLabel("B 小局胜", { exact: true }).fill(outcome === "b_win" ? String(m.bestOf === 1 ? 1 : 2) : "0");
  await card.getByLabel("最终大局结果").selectOption(outcome);
  await card.getByRole("button", { name: m.result ? "确认更正结果" : "确认最终结果与转神", exact: true }).click();
  await expect.poll(() => data.tournament.special_state!.events.length).toBeGreaterThan(before);
  await expect(page.getByRole("status").filter({ hasText: "操作已保存" })).toBeVisible();
  // Wait for the reloaded card to move to completed history or enter ruling state.
  if (outcome === "draw" && m.kind === "tiebreak") await expect(page.getByTestId(`god-match-${m.id}`).getByText(/仍未决胜/)).toBeVisible();
  else await expect(page.getByTestId(`god-match-${m.id}`)).not.toBeVisible();
}

test("a restored medal phase never offers a new revival, even with eligible idle players", async ({ page }) => {
  const s = specialRoster("single", [1, 2, 3, 4].map(i => ({ id: pid(i), name: `选手${i}` })));
  s.phase = "placements"; s.startsAt = new Date().toISOString(); s.deadlineAt = new Date(Date.now() + 3600_000).toISOString();
  for (const p of s.players) { p.initialAssigned = true; p.initialArrangements = 3; p.zeroBonusGranted = true; p.revivalEligible = true; p.status = "no_chance"; }
  const data: TournamentDetail = { tournament: base({ special_state: s }), entrants: [], mine: null, canManage: true };
  await mock(page, data); await page.goto(`/tournaments/${eventId}`);
  await expect(page.getByText(/当前已出局候选 4 人/)).toBeVisible();
  await expect(page.getByRole("button", { name: "随机匹配一轮复活赛" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "名次前置条件" })).toContainText("先完成全场一次复活赛");
});

test("create special event exposes single and A/B modes with registration enabled", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  const data: TournamentDetail = { tournament: base({ status: "published" }), entrants: [], mine: null, canManage: true };
  await mock(page, data); await page.route("**/api/tournaments", route => { submitted = route.request().postDataJSON(); Object.assign(data.tournament, submitted); return route.fulfill(ok({ id: eventId }, 201)); });
  await page.goto("/tournaments/new"); await page.getByRole("radio", { name: /^三幻神争夺/ }).check();
  await expect(page.getByLabel("三幻神分组模式")).toHaveValue("single"); await expect(page.getByLabel("三幻神分组模式").getByRole("option")).toHaveCount(2);
  await page.getByLabel("赛事名称").fill("三幻神校园杯"); await page.getByLabel("举办地点").fill("活动室");
  await page.getByLabel("举办日期与时间").fill("2099-10-24T13:30"); await page.getByLabel("预报名截止").fill("2099-10-24T12:30");
  await page.getByRole("button", { name: "发布并开放预报名" }).click();
  await expect(page.getByRole("heading", { name: "三幻神校园杯", exact: true })).toBeVisible(); expect(submitted).toMatchObject({ format: "three_gods", special_grouping: "single", status: "published" });
});

test("single special UI initializes gods, runs BO3 transfers and confirms the champion with score-based places", async ({ page }, info) => {
  const people = [1, 2, 3, 4].map(i => ({ id: pid(i), name: `幻神选手${i}`, status: "checked_in" as const }));
  const data: TournamentDetail = { tournament: base({ special_state: specialRoster("single", people) }), entrants: people, mine: null, canManage: true };
  await mock(page, data); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/tournaments/${eventId}`);
  for (const p of people) { const form = page.getByRole("form", { name: `初始神确认 ${p.name}` }); await form.getByRole("combobox", { name: "初始幻神", exact: true }).selectOption("slifer"); await form.getByRole("button", { name: "确认并锁定初始类别" }).click(); await expect(form).toHaveCount(0); }
  await page.getByRole("button", { name: "启动正赛并随机匹配" }).click(); await expect(page.getByRole("heading", { name: /正在进行 \/ 待裁判的对局/ })).toBeVisible();
  for (let i = 0; !data.tournament.special_state!.candidates.length && i < 20; i++) {
    const m = data.tournament.special_state!.matches.find(m => m.kind === "main" && m.status !== "completed")!; await enterResult(page, data, m, "a_win");
  }
  for (const m of data.tournament.special_state!.matches.filter(m => m.kind === "main" && m.status !== "completed")) await enterResult(page, data, m, "draw");
  const s = data.tournament.special_state!, candidate = s.candidates[0].playerId, others = s.players.filter(p => p.id !== candidate);
  for (let i = 0; i < others.length; i++) {
    const p = others[i], card = page.getByTestId(`god-player-${p.id}`), target = 20 - i * 5;
    await card.getByText("库存、状态与裁判调整", { exact: true }).click(); await card.getByLabel("公开操作原因（至少 4 字）").fill("现场积分核对更正");
    await card.getByLabel("正赛积分调整（可负数）").fill(String(target - p.points)); await card.getByRole("button", { name: "记录积分纠错" }).click();
    await expect.poll(() => data.tournament.special_state!.players.find(row => row.id === p.id)!.points).toBe(target);
  }
  const candidateName = s.players.find(p => p.id === candidate)!.name;
  await page.getByRole("checkbox", { name: new RegExp(candidateName + " ·") }).check();
  await page.getByLabel("候选窗口 / 到时排名的裁判记录").fill("核对所有在打对局已结束，确认唯一集齐候选");
  await page.getByRole("button", { name: "确认候选窗口并结算名次" }).click();
  await expect(page.getByRole("heading", { name: "赛事名次已确认" })).toBeVisible(); expect(data.tournament.special_state!.awards).toEqual([candidate, others[0].id, others[1].id]);
  await page.screenshot({ path: info.outputPath("three-gods-complete.png"), fullPage: true });
});

function revivalFixture() {
  let n = 100; const apply = (s: ThreeGodsState, c: ThreeGodsCommand) => applyThreeGodsCommand(s, pid(++n), c, () => 0.75);
  let s = specialRoster("single", [1, 2, 3, 4, 5, 6].map(i => ({ id: pid(i), name: `复活选手${i}` })));
  for (const p of s.players) s = apply(s, { kind: "initial", playerId: p.id, initialGod: null, group: "all", note: "初始无卡现场确认" });
  s = apply(s, { kind: "begin_main", note: "正式开始随机配对" });
  for (let i = 0; s.matches.some(m => m.status !== "completed") && i < 20; i++) { const m = s.matches.find(m => m.status !== "completed")!; s = apply(s, { kind: "result", matchId: m.id, outcome: "a_win", aWins: 2, bWins: 0, note: "已确认正赛结果" }); }
  for (const p of s.players) { while (s.players.find(row => row.id === p.id)!.initialArrangements < 3) s = apply(s, { kind: "arrangement", playerId: p.id, note: "确认该选手未参赛等待安排" }); s = apply(s, { kind: "score", playerId: p.id, delta: -s.players.find(row => row.id === p.id)!.points, note: "测试积分并列场景" }); }
  return s;
}

test("revival UI runs one random round, shows 1.5 bye and uses BO1 without modifying main points", async ({ page }, info) => {
  const state = revivalFixture(); const data: TournamentDetail = { tournament: base({ special_state: state, entry_count: 6, checked_in_count: 6 }), entrants: state.players.map(p => ({ id: p.id, name: p.name, status: "checked_in" })), mine: null, canManage: true };
  await mock(page, data); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/tournaments/${eventId}`);
  await page.getByRole("button", { name: "随机匹配一轮复活赛" }).click(); await expect(page.getByText(/本轮复活轮空：.*复活分 1.5/)).toBeVisible();
  for (const m of data.tournament.special_state!.matches.filter(m => m.kind === "revival" && m.status !== "completed")) await enterResult(page, data, m, "a_win");
  const tie = data.tournament.special_state!.matches.find(m => m.kind === "tiebreak" && m.status !== "completed")!; expect(tie).toBeTruthy();
  await enterResult(page, data, tie, "draw"); expect(data.tournament.special_state!.revival.winnerId).toBeNull();
  await enterResult(page, data, data.tournament.special_state!.matches.find(m => m.id === tie.id)!, "a_win");
  await expect(page.getByText(new RegExp("复活者："))).toBeVisible(); expect(data.tournament.special_state!.revival.winnerId).toBe(tie.aId);
  expect(data.tournament.special_state!.players.every(p => p.points === 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: info.outputPath("three-gods-revival-mobile.png"), fullPage: true });
});

test("Swiss deadlock recovery UI requires an explicit rematch confirmation and preserves prior rounds", async ({ page }) => {
  const rules = { format: "swiss_cut" as const, swissRounds: 5, topCut: 2 }; let s = startTournament(rules, [1, 2, 3, 4, 5, 6].map(i => ({ id: pid(i), name: `选手${i}`, seed: i, active: true })));
  const win = (ids: number[]) => { for (const seed of ids) { const m = s.matches.find(m => !m.result && [m.aId, m.bId].includes(pid(seed)))!; s = recordResult(s, m.id, m.aId === pid(seed) ? "a_win" : "b_win"); } };
  win([1, 3, 5]); s = nextSwissRound(rules, s); win([3, 5, 6]); s = nextSwissRound(rules, s); win([3, 1, 2]); const original = JSON.stringify(s.matches);
  const data: TournamentDetail = { tournament: base({ format: "swiss_cut", swiss_rounds: 5, state: s }), entrants: [], mine: null, canManage: true };
  await mock(page, data); await page.goto(`/tournaments/${eventId}`); await page.getByRole("button", { name: "确认本轮结束，生成下一轮" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("无法");
  await page.getByText("自动配对无解时：组织者人工恢复", { exact: true }).click();
  await page.getByLabel("按初始种子序号输入配对").fill("1-4, 2-3, 5-6"); await page.getByLabel("人工恢复原因").fill("当前无全匹配，组织者公开确认一场重赛");
  await page.getByRole("button", { name: "确认并公布人工恢复配对" }).click(); await expect(page.locator("main [role=alert]")).toContainText("允许重赛");
  await page.getByRole("checkbox", { name: /我明确确认本次人工配对允许重赛/ }).check(); await page.getByRole("button", { name: "确认并公布人工恢复配对" }).click();
  await expect.poll(() => data.tournament.state!.currentRound).toBe(4); expect(JSON.stringify(data.tournament.state!.matches.slice(0, 9))).toBe(original);
  expect(data.tournament.state!.history.at(-1)!.detail).toContain("明确确认 1 场重赛");
});

test("A/B management UI confirms group leaders and runs separate championship and third-place matches", async ({ page }, info) => {
  let n = 300; const apply = (s: ThreeGodsState, c: ThreeGodsCommand) => applyThreeGodsCommand(s, pid(++n), c, () => 0.75);
  let s = specialRoster("ab", [1, 2, 3, 4, 5, 6].map(i => ({ id: pid(i), name: `组冠选手${i}` })));
  for (let i = 1; i <= 6; i++) s = apply(s, { kind: "initial", playerId: pid(i), group: i <= 3 ? "A" : "B", initialGod: "slifer", note: "现场确认分组与初始卡" });
  s = apply(s, { kind: "begin_main", note: "现场正式启动分组正赛" });
  for (const group of ["A", "B"] as const) {
    const members = s.players.filter(p => p.group === group);
    s = apply(s, { kind: "inventory", playerId: members[0].id, god: "slifer", amount: 2, operation: "add", note: "现场库存核对集齐记录" });
    for (const m of s.matches.filter(m => m.group === group && m.status !== "completed")) s = apply(s, { kind: "result", matchId: m.id, outcome: "draw", aWins: 1, bWins: 1, note: "当前对局全部完成登记" });
    s = apply(s, { kind: "score", playerId: members[1].id, delta: 10 - s.players.find(p => p.id === members[1].id)!.points, note: "现场核对组内积分" });
  }
  const data: TournamentDetail = { tournament: base({ special_grouping: "ab", special_state: s, entry_count: 6, checked_in_count: 6 }), entrants: s.players.map(p => ({ id: p.id, name: p.name, status: "checked_in" })), mine: null, canManage: true };
  await mock(page, data); await page.goto(`/tournaments/${eventId}`);
  for (const group of ["A", "B"] as const) {
    const box = page.getByRole("heading", { name: `${group} 组`, exact: true }).locator("..");
    await box.getByRole("checkbox").check(); await box.getByLabel("候选窗口 / 到时排名的裁判记录").fill("已结束组内在打对局，核对唯一组冠与积分亚军");
    await box.getByRole("button", { name: `确认 ${group} 组冠军及积分亚军` }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`${group} 组 · 组冠`) })).toBeVisible();
  }
  await page.getByRole("button", { name: "开启冠亚军赛与季军赛" }).click();
  await expect.poll(() => data.tournament.special_state!.phase).toBe("finals");
  const final = data.tournament.special_state!.matches.find(m => m.kind === "championship")!, third = data.tournament.special_state!.matches.find(m => m.kind === "third_place")!;
  await enterResult(page, data, final, "a_win"); await enterResult(page, data, third, "b_win");
  await expect(page.getByRole("heading", { name: "赛事名次已确认" })).toBeVisible();
  expect(data.tournament.special_state!.awards).toEqual([final.aId, final.bId, third.bId]);
  await page.screenshot({ path: info.outputPath("three-gods-ab-places.png"), fullPage: true });
});
