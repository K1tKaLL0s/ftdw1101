# CI 依赖审计处置

2026-10-21 核对。保留 `.github/workflows/ci.yml` 的 `npm audit --audit-level=low`，没有降低门槛、忽略公告、改名伪装包版本或用仅生产扫描替换全量扫描。

## 九项报告实际来自两个漏洞

| npm 报告的包 | 性质 / 依赖路径 | 当前处置 |
| --- | --- | --- |
| postcss-selector-parser 6.1.5 | CSS 解析器，GHSA-rj75-hqrm-r3gf，构建依赖 | 替换为官方修复版 7.1.6 |
| postcss-nested 6.2.0 | Tailwind → postcss-nested → 上述解析器，继承告警 | 同一解析器替换后消除 |
| braces 3.0.3 | GHSA-vfj7-8cjw-p6xm，唯一剩余原始漏洞 | 上游仍无修复版本 |
| micromatch 4.0.8 | micromatch → braces | 继承同一漏洞 |
| fast-glob 3.3.3 / 3.3.1 | fast-glob → micromatch → braces | 继承同一漏洞 |
| chokidar 3.6.0 | Tailwind → chokidar → braces | 继承同一漏洞 |
| tailwindcss 3.4.19 | chokidar、micromatch、fast-glob 三条链 | 继承同一漏洞 |
| @next/eslint-plugin-next 16.3.8 | 插件 → fast-glob → micromatch → braces | 继承同一漏洞 |
| eslint-config-next 16.3.8 | 配置 → Next ESLint 插件 → 上述链 | 继承同一漏洞 |

修复解析器后，全量审计为 **7 high、0 moderate**，均由一个 braces 公告传播；不将“七项包报告”称作七个独立漏洞。`npm audit --omit=dev --audit-level=low` 为 0，但这不代表全量 CI 通过。

## 已实施的最小修复

保留 Tailwind 3.4.19，使用 npm 支持的、限定在 Tailwind 依赖树内的 `overrides`，把直接及 postcss-nested 下的 postcss-selector-parser 固定为官方 7.1.6。未运行 `--force`，未迁移 Tailwind 4。

这项替换明确跨越了解析器 6→7，不能冒称普通补丁：上游 v7 变更是安全处理迭代中插入节点。为验证本项目兼容性，保留替换前 CSS，并比较重新构建产物；文件和 SHA-256 完全一致：`47401D8D7E669F1AEBC95DABA6142EAD71CABC4A9E4C64A35D17F81416423074`。类型检查、lint、86/86 单元/SQL、27/27 浏览器、Vercel/EdgeOne/普通构建均通过；日志为 E 盘 `verification-production/parser-*`。这只证明本项目当前输入兼容，不承诺所有第三方配置均兼容。

此前已更新 Next/eslint-config-next 16.3.6→16.3.8、Sharp 0.35.4→0.35.5，并修复可兼容的传递依赖；没有删除运行功能。

## 剩余 braces 的实际使用和风险

这些路径属于开发/构建依赖。Tailwind 从版本库内 `tailwind.config.ts` 的固定源码 glob 读取类名，Chokidar 用于开发文件监听，Next ESLint 插件在 lint 时读取项目目录；赛事标题、报名昵称、结果及数据库字段不会作为这些工具的 glob 输入。

实际运行依赖审计为 0；已构建的 standalone 中没有独立的 braces、tailwindcss 或 eslint-config-next 包。这个事实降低了网站请求触发该依赖的可能性，但不消除 CI/本地构建风险：不受信任的深层 brace 模式仍可能让工具进程栈溢出退出。不能把它写成“已修复”或据此自动放行 CI。

已核对 npm 当前最新版：braces 3.0.3、micromatch 4.0.8、fast-glob 3.3.3；后两者仍依赖有问题的 braces 链，Tailwind 3 最新 3.4.19 亦然。单纯兼容更新这些版本不能移除漏洞。Chokidar 从 v4 移除了 glob 支持，v5 又改为 ESM-only，不能直接覆盖 Tailwind 3 所需的 v3；只升级 Tailwind 也不会移除 Next ESLint 的另一条路径。npm 建议强制迁移 Tailwind 4 或把 Next lint 配置降到 14，均不是本次允许的无风险补丁。

## 合并前处置选项

1. 保留完整扫描和 PR，等待上游发布修复，再替换并回归。
2. 单独授权工具链迁移：同时处理 Tailwind 的 glob/watch 路径和 Next ESLint 路径，不能只升级一端；需重新验证样式、热更新、lint 规则及三个部署入口。
3. 若采用受维护的兼容替代或可审查补丁，先核实来源、许可和 API，完成深层模式回归与构建测试，再替换。当前未找到可直接证明安全且兼容的官方替代，不临时引入未知 fork。

在现有“检查通过后合并”要求下，这七项仍阻断合并。本文不提出跳过或豁免扫描。

参考：[braces 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[解析器修复公告](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)、[7.1.6 发布](https://github.com/postcss/postcss-selector-parser/releases/tag/7.1.6)、[解析器 v7 变更](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0)、[Chokidar 升级说明](https://github.com/paulmillr/chokidar#upgrading)、[npm overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides)。
