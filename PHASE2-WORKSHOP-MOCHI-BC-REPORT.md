# PHASE2 — Workshop / Mochi B/C 集成交付

日期：2026-10-19（Asia/Shanghai）

## 结论

**BLOCKED：正式在线 Mochi 修改 Provider 未接入并通过安全批准。**

Workshop presentation 映射和隔离 Runtime UI 闭环已完成，可交独立 QA 审查；生产修改入口保持禁用。没有真实模型、付费 API、任意 TSX 执行、Force Push、合并或部署。本报告不宣布 READY FOR MERGE。

## 精确版本与 PR

| 项目 | SHA / 状态 |
| --- | --- |
| 开工重新 fetch 的 main | `d644835bc915528fddc873e2687c84471f22ec52` |
| PR #49 实际远端 HEAD | `737f965ae923ccfb4d2a9a6315e3988afe1eb2cc`，Draft/open |
| 原本地成果 | `e02dedbd688baee753fd1cf91e31cc113244b712`，已保存；TS18048 已修复 |
| 本地整合代码提交 | `4ab6dcfed3272c1e70f36d48bc462eabcf65f53f`，保存于 `archive/workshop-local-4ab6dcf` |
| 最终受测代码 / 远端代码 HEAD | `c7c4b086551247ad60ae0e1e5a87e254155abd03` |
| 代码文件树 | `e3bfded43e9886eb852a248c31e8c1eac0b1d770`（与 4ab6dcf 完全一致） |
| 分支 | `phase2/workshop-mochi-integration` |
| Draft PR | https://github.com/Nanmuxxx/BlockCraft-AI/pull/51 |

**Depends on #49。** PR #51 以 #49 的 `handoff/mochi-editing-0c45cf5-20261019-7c8e` 为 base，代码差异不包含 Engine 的 14 个文件变更。#49 合并后再由负责人 retarget main。使用 stacked PR 是因为官方 BlockPresentation 类型、验证器和受控命令尚未进入 main。

本机 shell HTTPS 无推送凭证；通过已连接 GitHub 接口创建同一 tree 的提交并创建独立远端分支，未 force 更新任何分支。提交身份/SHA 与本地历史不同，tree 已逐字节核对。本报告和证据随后以文档提交追加；**受测代码 SHA 始终是 c7c4b08，不把文档提交冒称为重新运行的代码 SHA**。

## Windows ZIP 接收审查

- 已收到 `BlockCraft-AI-phase2-mochi-bc-a1fa755-20261019.zip`；249 个 ZIP 条目，按 Windows 反斜杠规范化路径后隔离解包，拒绝绝对路径及 `..`；未运行归档脚本。
- 本地 SHA256：`f81ee443b7911803a88c448a4e0114ed966ca2e645d2eca8862970e47cbdfeb1`。
- **移交方期望 SHA256 尚未提供，不能声称来源一致性校验完成。** 可继续独立源码审查，待 Tech Lead/移交方补值。
- 报告声明基线 `a1fa755`；已解析为 `a1fa7550744ac5189d9dad7fb758d16437d4b66d`，对归档全部文件做 CRLF 规范化比较。归档没有 Git 历史，不能证明原提交归属。
- 完整条目字节数、单文件 SHA256、与基线的差异清单：`docs/workshop-mochi/windows-handoff-manifest.json`。
- 除指定 presentation 文件外，归档还改了 AiCreate、Workshop、CSS，附有 generated 产物和 UX 测试；均未直接覆盖当前版本。
- 吸收防御读取、默认样式零回归、B/C 容器映射、单元测试思路。旧版 `buttonLabel`、RGB/短 HEX、0–64/小数圆角与 #49 不兼容，已按官方 Schema 重写。旧版将按钮文案作用于列表、新增/编辑行为的改动未带入。
- Windows 169/169、11/11、13/13 是旧树报告结果，本次不计入当前 PASS。

## 接口审计与所有权

- 正式产品：`AiCreate → AppSpecWorkshop → MochiWorkshop`。一个 Runtime 对应一个 effect 管理的 Host；B/C 模式切换不新建 Runtime。
- B 正式卡片：`CustomBlockCanvas` 订阅 adapter/owner 的 snapshot，经 `orderedBlocks` 读取 `item.block`；旧 `AppSpecCanvas → BlockCanvas` 也是受支持消费者。
- C：`CustomBlockRunSurface → BuiltinBlockRenderer` 订阅同一 Runtime facade，块来自相同 owner 的 `base.spec.blocks`。
- `AppRenderer.tsx` 的 #49 改动已审查：支持三项容器样式、form 新建提交文案；保留编辑记录「保存修改」、列表「新增记录」和 pomodoro 分支。本次仅将读取/样式投影替换为共享 helper，没有覆盖旧文件。
- UI 只负责显示和用户交互；未修改 Engine、Host、AppChangePlan、命令白名单、CAS、授权、Provider 或服务端。
- 请求与确认仍由现有 Host 持有 requestId、scope、选择 epoch、项目身份、revision 和授权 token。Preview 不授予新权限；Confirm 使用被持有计划与原授权，终点仍是 Runtime/owner CAS。没有刷新旧 token/revision 使旧计划通过。
- 生产 wrapper 仍注入 `unavailablePlanProvider` 和 `AI_MODIFICATION_DISABLED`；advice 连接可用不代表修改授权。不新增生产 Mock fallback。
- 新隔离 `/__presentation` 仅由浏览器脚本的临时 Vite middleware 提供，不存在于生产路由。使用 existing `MochiWorkshop` 内部测试组合、受控 JSON completion adapter 和真实 Runtime。

## Workshop 修改文件

- `package.json`：根测试纳入 presentation；增加独立浏览器脚本。
- `src/components/blocks/presentation.ts`：唯一官方 Schema 显示投影。
- `src/components/blocks/presentation.test.cjs`：11 项防御/默认/渲染测试。
- `src/components/blocks/contract.ts`、`app-canvas.ts`：旧 canvas 的类型与 snapshot 投影。
- `src/components/BlockCanvas.tsx`、`src/integrations/custom-block-bc/CustomBlockCanvas.tsx`：两个 B 消费者复用 helper，保留现有选中/拖动。
- `src/components/app-renderer/AppRenderer.tsx`：C 复用 helper，保留官方提交文案行为。
- `tests/workshop-presentation/fixture.tsx`、`browser.cjs`：隔离真实 Runtime UI 闭环与独立生产 build 验收。
- `tests/workshop-export/browser.cjs`：记录 SHA，使用指定桌面/手机尺寸。
- `docs/workshop-mochi/windows-handoff-manifest.json`、`evidence/*`、本报告：来源清单与精确测试证据。

## 唯一 presentation 映射

共享函数：`src/components/blocks/presentation.ts`。官方类型复用 model 的 BlockPresentation，不维护第二套 Schema 或状态仓库。

| 属性 | #49 契约 | B/C 显示 |
| --- | --- | --- |
| `buttonText` | 仅 form，非空字符串 ≤120，保留原文本 | B 卡片详情显示按钮文案；C 新建表单提交按钮使用该文本 |
| `backgroundColor` | `#RRGGBB` | 容器 backgroundColor |
| `textColor` | `#RRGGBB` | 容器 color（不改写原有子控件样式） |
| `borderRadius` | 整数 0–32 px | 容器 borderRadius，0 有效 |

缺省值产生空样式对象，原 CSS 默认保留。非法字段逐项丢弃，不复制未知键；读取 own data descriptor，不调用 getter。业务写入仍由官方严格验证器拒绝非法命令。文字使用 React 文本节点，不执行 HTML/CSS/TSX。form 的 buttonText 不覆盖名称、列表按钮或已有记录「保存修改」。部分 patch 保留旧字段；null/删除/reset 不是本轮协议能力。

## 统一测试（精确 c7c4b086551247ad60ae0e1e5a87e254155abd03）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 根测试（既有 194 + 新增 11） | 205/205 PASS | `evidence/root.txt` |
| presentation 独立单测 | 11/11 PASS | `evidence/presentation.txt` |
| Mochi Host、presentation、授权、owner 回归 | 93/93 PASS | `evidence/security.txt` |
| #49 native presentation / editing safety | 75/75 PASS | `evidence/native.txt` |
| `npx tsc -b` | PASS（exit 0） | `evidence/types.txt` |
| `npm run build` | PASS | `evidence/build.txt` |
| Workshop ZIP 单测 | 9/9 PASS | `evidence/zip-workshop.txt` |
| React ZIP 全回归 | 63/63 PASS | `evidence/zip-project.txt` |
| 新隔离 UI + 生产 build 页面 | 4/4 PASS；1366×1000、390×844 各两种 surface | `evidence/presentation-browser.json` |
| ZIP 正式页面 + 能力门禁 | 4/4 PASS；产品 1366×1000、390×844 + ordinary dev/production preview | `evidence/export-browser.json` |
| 既有 Mochi 大回归 | 2/2 视口 PASS；1366×768、390×844 | `evidence/mochi-browser.json` |

所有 evidence 相对路径均位于 `docs/workshop-mochi/`。原始全量日志、截图在工作树 `.cache/workshop-final/`，截图散列及本地位置见 `evidence/screenshots.json`。Chromium `156.0.8078.4`，Node `v24.22.0`。旧 Mochi 桌面回归保持自身 1366×768，不拿它替代本轮 1366×1000 验收。

## 浏览器闭环证据与限制

1. 隔离测试 UI 上选择报名表并输入请求；completion fixture 返回官方 configureBlockPresentation JSON，Host 校验并显示差异。
2. Preview 时 Runtime snapshot 与 revision 不变，B 样式不变；切到 C 仍为「提交」。
3. 点击真实确认按钮后出现「本次提交回执版本：1」；revision 0→1；B/C 容器同为 `rgb(171,205,239)`、`rgb(18,52,86)`、12px，C 文案「立即报名」。
4. 第二次仅 patch radius=0，revision 再加 1，其余字段保留；B/C 均 0px。
5. Cancel 保留原 snapshot；改选积木清除旧计划；并发 Runtime 布局提交使旧 revision 确认拒绝且不覆盖业务值。
6. CONFIRMING 通知中撤销授权，旧计划不写入；readonly 请求不获得预览；危险 url 色值不能入状态。
7. 取消请求后故意返回迟到 completion，不发布 Preview；请求中替换真实 Runtime/Host 后，旧项目 snapshot 不变，新项目 revision=0，无 presentation 污染。
8. 生产 build `/ai-create`：仅拦截生成 HTTP JSON 与 AI status，真实产品组件接收官方 presentation 并正确渲染 B/C；正式修改输入保持 disabled；不存在测试 Runtime global。
9. 两种指定视口无横向溢出；新用例无 pageerror、console.error、意外网络请求；ZIP 和既有 Mochi 回归也无未处理页面错误。

**隔离 completion 不理解自然语言，不是实时 AI。生产页面通过不代表正式 Provider 已可修改。**

## 已知阻塞及下一步交接

- P0 BLOCKED：需要 Provider 负责人提交安全可用的修改计划适配器与明确批准，才可在既有单 Host 工厂启用正式在线修改。不得仅移除 disabled。
- 来源校验待办：移交方提供 ZIP SHA256，与本地 digest 交叉核验；当前仅确认文件内容审查及本地完整性清单。
- ZIP 边界：当前下载/CRUD/权限与快照回归通过，但现有 `tools/project-zip-export/templates.mjs` 不消费 presentation；导出项目暂不保证本次文案/颜色/圆角。该模块属于 ZIP 负责人，本次未跨所有权修改。独立 QA 应明确检查；需 Tech Lead 协调其后续实现或明确产品限制。
- UI 使用官方受限颜色，并不自动保证任意背景/文字组合的对比度。手机为长页面布局，功能可操作，无横向溢出；未宣称布局重设计或全部可访问性审计。
- 本轮唯一 Workshop 集成负责人已按授权完成代码；Windows 负责人仅移交。今后任何共享文件继续由 Tech Lead 确定单一修改者。
- #49 先独立 QA；#51 保持 Draft。不要合并/部署；等 Provider、安全及 ZIP 边界由对应负责人处理，再做正式在线全链路验收。

## 独立 QA 复现

1. fetch PR #51 并 checkout 受测 SHA `c7c4b086551247ad60ae0e1e5a87e254155abd03`，确认 tree `e3bfded43e9886eb852a248c31e8c1eac0b1d770`；不要只 checkout main。
2. `npm ci`；`npm test`；`node --test src/components/blocks/presentation.test.cjs`。
3. `node --test src/integrations/mochi/host.test.cjs tests/mochi/presentation.test.cjs tests/custom-block-workshop/authorization.test.cjs tests/custom-block-workshop/owner.test.cjs`。
4. Node24：`node --experimental-transform-types --test tests/mochi/*native.test.mjs`；`npx tsc -b`；`npm run build`。
5. `npm run test:workshop-export`；`node --test tests/project-zip-export/*.test.mjs`。
6. 准备 Playwright/Chromium（本仓库不新增其生产依赖），设置 NODE_PATH 指向含 playwright 的 node_modules；执行 `npm run test:workshop-presentation:browser`，`npm run test:workshop-export:browser`，`MOCHI_QA_MODEL_PLAN=1 npm run test:mochi:browser`。不要设置任何真实 AI key。
7. 核对 report.json 的精确 SHA、截图和阶段分类；可手工在 preview 前后观察 B/C，禁止把测试 fixture 视为线上 AI。
