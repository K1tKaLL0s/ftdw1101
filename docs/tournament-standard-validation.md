# 赛事功能生产基线整合验收

本次开发目录为 `E:/CodexData/2026-10-21/task-4/ftdw1101-production`，分支 `feat/tournaments-production`，直接基于实际生产提交 `f0a6191f6d56b21c8aaa622de00b3f8f74765e18`。本文记录合并前验收与发布路径；不把本地测试等同于线上验收。

## 基线与原副本保全

此前 `e042ce7` 保存的是 `E:/CodexData/2026-09-24/new-chat-2/work/ftdw1101` 这份较早副本，不能据此判断本机整体落后。随后已找到本机生产工作树 `E:/CodexData/2026-09-24/new-chat-2/work/ftdw1101-edgeone`：当前分支 `codex/vercel-deploy`、HEAD `f0a6191`，origin 为 `eiepyc/ftdw1101`，deploy 为 `K1tKaLL0s/ftdw1101`。该目录名称带 edgeone，但当前分支实际为 Vercel 生产分支。它的 deploy tracking 仍为 `8f80b25`、本地 ahead 4，而 GitHub 实际生产分支已经是 `f0a6191`，属于 tracking 未刷新，不能据此称未发布。

两个原目录和原赛事分支 `887ca87` 均保留。从本机生产目录只读复用 Git 对象建立本隔离工作树，未覆盖原副本。远端 `main=1c69b57` 是早期版本，不是本次部署基线。原赛事里程碑为 `6fea807`，特殊赛制与两项旧 P2 为 `887ca87`；本次只移植 `e042ce7..887ca87` 的赛事增量，再修复新增审查问题。

现有浏览器会话确认 Vercel 项目 `k1tkall0s/ftdw1101`，仓库 `K1tKaLL0s/ftdw1101`，生产分支 `codex/vercel-deploy`，部署 `FX51n1GFyMSf3uG1Z3wLtTmVG73v` 来源为 `f0a6191`。正式域名保留 `https://project-ch3x2.vercel.app`，不改域名。旧登记域名 `ftdw1101.vercel.app` 未列在该项目域名配置，本机访问连接关闭，不能推断它被删除。

## 保留生产已有功能

不替换首页；赛事接入既有 `/schedule` 五时段日历，并保留个人中心、头像、密码恢复和强制改密、本人预约删除、逐时段昵称/场地/备注、沿用预约、当前时段高亮、AstrBot 查询接口。认证、代理模式和 Vercel/EdgeOne 构建脚本保留生产版本。为处理现有 CI 审计发现的生产依赖漏洞，Next/eslint-config-next 仅补丁更新 16.3.6→16.3.8、Sharp 0.35.4→0.35.5，并更新可兼容的传递依赖；不执行 force 修复或 Tailwind 大版本迁移。

新增赛事接口复用生产 `requireSession`，强制改密会话须先完成改密，不能调用赛事业务 RPC。真实 Next HTTP 回归覆盖赛事列表、详情和写操作的强制改密拦截。

## 本地验证

- `npm test`：86/86，包括原生产测试和赛事/数据库/三幻神回归。
- `npm run typecheck`、`npm run lint`：通过。
- `npm run build:vercel`、`npm run build:edgeone`、`npm run build`：全部通过，保留各平台现有构建入口。
- `npm run test:e2e`：27/27，通过生产与赛事组合浏览器验收，包含五时段/时段外赛事、个人预约操作、密码恢复与真实 HTTP 强制改密拦截，以及复活/名次交错的 UI 回归。
- 原完整 `npm audit --audit-level=low` 报告 12 项漏洞；安全补丁和非 force 修复后仍有 9 项构建/开发依赖告警（braces 上游无补丁、PostCSS selector parser），属于现有 CI 的明确阻碍。没有改低扫描门槛或隐藏失败。`npm audit --omit=dev --audit-level=low` 为 0 漏洞，但不将其替代完整 CI 结果。具体公告：https://github.com/advisories/GHSA-vfj7-8cjw-p6xm 与 https://github.com/advisories/GHSA-rj75-hqrm-r3gf 。
- 浏览器用本地产物及测试 API fixture；真实 HTTP 测认证、同源、body、cookie、CSP，PGlite 执行完整九次迁移。尚不能据此声称真实线上 Auth、邮件或数据库并发验收完成。

日志位于 `E:/CodexData/2026-10-21/task-4/verification-production/`；浏览器报告与截图使用本任务 E 盘独立 production 输出目录。所有安装、缓存、构建、临时文件保存在 E 盘；未关闭 TLS 证书验证。Git HTTPS 握手失败后复用了本机已有生产 Git 对象。

## 赛事与权限

正常登录用户可创建发布自己的赛事，发布者只管理自己的赛事，原管理员保留管理能力；报名者只操作本人预报名。赛事名 trim 后按 `Intl.Segmenter` grapheme 限 1–25 字，前后端共用校验；SQL 只做非空/字节防护，不把码点计数当 grapheme。显示昵称和赛事内 ID 为公开比赛资料，不返回账号 ID、邮箱、token。

同一五时段日历提供普通约牌/赛事筛选；赛事时间按上海日期映射五时段，08:00 前或 22:00 后以“预约时段外”放在对应日期内，不丢失或错标到其他预约窗口。预报名人数与当天正式报到人数分开，发布者按赛事时区的当地日期确认报到；重复报到幂等。开赛只快照已报到者，开赛后新增报到不会改动已发布配对。报名、报到、开赛使用赛事行锁，状态写入使用 revision CAS。

传统赛制为 3–7 轮瑞士预选加 Top Cut 单败。校赛积分胜 3、平 1、负/双方负 0、bye 3；排序总分→OMW→OOMW，真实积分率为 `(3胜+平)/(3真实完成对局数)`，bye 不计对手与分母，无对手内部 0、显示“—”，不套 33% 下限。完全同小分影响晋级/种子时需预先公开办法及人工顺序，不暗按 ID。避重赛配对死锁时，组织者可显式人工公布下一轮，重赛/重复 bye 各自确认并记录理由；不改已发布轮次。退赛不补未来负场，淘汰赛平局/双方负不自动晋级。

伪双败为胜者组/败者组及单场总决赛，无 reset，公开说明胜者组冠军可能首次失利获亚军。bye 不算败；2/3/5/8/16 人的无弃权路径验证真实比赛数 `2N−2`。

## 三幻神状态机与审查修复

支持不分组与 A/B。初始类别锁定，三类库存独立；录入、移除、转移、资格、生命及记分更正都有公开原因与事实记录，不删除原始选手/对局。2:0 为 4/0，2:1 为 4/1，平局本场最终 1/1、双方负本场最终 0/0，不另加小局分、不改历史场分；平/双方负不转神。决出胜负时随机转移败者一张现有卡，无卡不补发。每张神为生命，赢不耗；首次零卡额外机会，再输耗尽，初始无卡的一次即额外机会。比分/生命/转神一次原子状态提交，命令 UUID/指纹防重复，revision 防覆盖。

匹配优先不同初始神；本批实际参赛人数 70% 完成即尝试下一批，忙碌者不重复进场。实际参赛次数、组批次、初始无卡前三安排分开。正赛奇数等待不加分/扣命；已出局者等待，不强迫对局。全体初始无卡完成前三安排后，对前三安排内出局候选统一随机一轮 BO3，bye 1.5，按复活分＋正赛分×60% 复活全场一人；指标不回写正赛分，并列第一 BO1。

不分组确认同时窗口后，较少实际场数优先，再三异优先；另一候选亚，其余最高分季。仅一人集齐时其余前二为亚季，无人集齐到时按分前三。A/B 组冠产生即停该组新配对，结束在打局后按分取组亚，再打冠亚/季军赛。总 3.5 小时包含名次赛，已进入名次赛可超时。

已修复：瑞士死锁人工恢复、未发布草稿取消后保持私有，以及名次阶段新开复活导致提前 complete 的交错。复活只能在正赛/候选等待阶段开启；进入名次前须确认前三安排、处理必要复活，已开始的复活与 BO1 必须结束；赛事 complete 前再次检查全部未完对局。UI 和领域状态机均限制，有合法交错和旧状态兼容回归。

未明确边界仍可见待裁判：同时窗口/超过两名候选、BO1 未决、A/B 单组冠到时、迟录实际完成时点、无卡额外机会遇双方负、总时限到而复活资格未决。不得静默丢弃复活、截断在打局或凭提交顺序造名次。影响已发布后续配对/复活/名次的更正展示影响并阻止静默回滚。

## 唯一新增迁移与发布步骤

唯一增量为 `supabase/migrations/20261021081932_tournaments.sql`，由官方 CLI migration new 创建，仍未在生产执行。生产已经有八个旧迁移，包括四次注册/五时段/账号恢复/机器人后续迁移；本分支保留它们，禁止重放或替换。

新增两表 `public.tournaments`、`public.tournament_entries`，索引、私有 DTO helper 和八个 RPC：`app_tournament_list/detail/create/registration/status/commit/special_start/special_commit`。新增表 RLS，撤销 PUBLIC/anon/authenticated/service_role 直接表权限，只向 service_role 授予特定 RPC；每个 RPC 检查现有 opaque session、活动状态和赛事所有权。旧表/函数/授权/数据不改，运行时赛事管理追加既有 audit_log。

只读线上核对确认项目 Healthy、PostgreSQL 17，依赖 `auth.users(id uuid)`、`profiles.role/status`、`app_sessions`、`audit_log`、`app_private.assert_actor(text,boolean)`、`assert_week_window(text,integer,integer)` 均存在兼容，新对象无冲突。完整生产八迁移后再执行唯一增量的 PGlite 回归确认账号/session 数据及现有 session-context/五时段写函数保持不变。

1. 赛事整合分支提交 PR，目标 `codex/vercel-deploy`；检查独立审查、CI、完整生产/赛事测试和构建，只通过 PR 合并，不 force push 生产。
2. 生产仓库原文档指定 Supabase GitHub 集成为唯一迁移入口。现有 Chrome 访问该项目集成页跳转登录，本轮未重登录/扩权限；MCP 可读迁移历史但未暴露集成开关，因此当前自动迁移机制尚待确认。先核对集成日志/配置：若已自动应用本迁移，不重复手工；未知结果先查表与历史。只允许这一个已审查增量，不重放旧迁移。
3. 保留 `APP_ORIGIN=https://project-ch3x2.vercel.app` 规范域名及生产 `APP_PROXY_MODE=vercel` 逻辑；七个现有服务端变量及 APP_PROXY_MODE 的名称已在 Vercel 确认，不展开密钥、不复制生产密钥给 Preview、不新增凭据或收费资源。
4. 合并会触发 Vercel 生产分支部署。随后检查实际新提交部署、健康端点、首页/账号/五时段/AstrBot，以及真实认证下的发布者/另一用户/管理员和赛事闭环；不能仅凭 PR 或本地 fixture 宣称线上可用。回滚应用时保留数据，不反向执行迁移。

自定义面板只提交简要后续方案，见 `docs/custom-tournament-panel-proposal.md`，不以通用引擎替代本次具体功能。

## 规则参考

- OCG：https://www.yugioh-card.com/japan/event/regulation/duel/
- BO1：https://www.yugioh-card.com/japan/event/regulation/oneduel/
- TCG v2.5（只参考小分结构，不冒充 OCG/KTS）：https://www.yugioh-card.com/en/downloads/penalty_guide/YGOTCG_Tournament_Policy_v_2_5.pdf
- 双败结构参考：https://support.faceit.com/hc/en-us/articles/17048704436508-Tournament-formats-Single-and-Double-elimination
