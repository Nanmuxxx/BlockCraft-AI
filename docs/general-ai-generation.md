# Phase G1：通用生成模块（独立 PR，等待代码审核）

仅交付独立 Prompt、生成质量评审和离线测试。**尚未接入现有生成路由，线上行为未改变。** 没有网络生成、自动修复、业务模板、新 primitive 或 Phase A 重复实现。

## 变更文件

| 文件 | 用途 |
| --- | --- |
| `server/aiGenerationPrompt.mjs` | 从原始协议构造通用生成 system/user messages |
| `server/aiGenerationQuality.mjs` | 独立结构/完整性/需求证据检查；独立评审 Prompt 构造 |
| `tests/generation/fixtures.mjs` | 7 个手写离线模型结果契约，含用户临时指定的电影需求 |
| `tests/generation/generation.test.mjs` | Prompt、质量边界、需求证据、实际 Runtime CRUD 与统计 |
| `tests/generation/compatibility.test.mjs` | 原生成路由接受可变组合和旧结果、错误结构与恢复 |
| `tests/generation/browser.cjs` | 7 个应用在真实 Renderer 中录入；错误保留应用与数据 |
| `package.json` | 追加两个独立测试命令，保留原测试命令 |
| `docs/general-ai-generation.md` | 设计、接入、验证及限制说明 |

没有修改 `server/index.mjs`、AppSpec v1 / 基础验证器、Runtime / appCommands、Renderer、Workshop、Mochi、Docker 或部署配置。生产模块不导入测试案例或语义 capability 目录，不按行业关键词分支。

## Prompt 与动态组合

`readGenerationProtocol()` 沿用现有路由的协议来源及截断边界：读取 `src/model/appSpec.ts`，在 `export type FieldValue` 前截取。协议包含实体、字段、积木、绑定和 AppSpec；不将 ProjectState、记录或 commands 暴露为生成根结构。边界消失时立即抛错，要求审阅，不静默丢失约束。

`buildGenerationSystemPrompt()` 要求模型在内部依次识别最终目标、业务对象、字段、用户操作，再选择实际 primitive；不输出推理。`buildGenerationMessages(idea)` 将需求单独置于 user 消息中，校验与原路由相同的 1–4000 字符范围，系统规则不会随领域变化。

- 实体依据对象的独立生命周期拆分；数量由目标决定，不固定单实体，也不无故拆分。
- list 已有新增/编辑/删除；仅需要记录管理时可以只有一个 list。需要突出独立录入入口才增加 form。
- metric 仅在目标确实需要且能准确计算时增加；count 是记录条数，sum/average 是全部记录的单个 number 字段合计/均值。
- 同一对象的多个积木共享实体绑定；字段、必填项、选项和展示内容依当前目标确定。所有字段必须能够输入，避免生成空对象、孤立实体和不可操作字段。
- 用户要求的部分能力不可实现时，准确命名可运行部分并标明未支持内容；不能宣称替代性记录已实现原目标。若完全没有诚实可运行的部分，允许模型返回基础 v1 合法的空 Spec 并命名为暂不支持，随后由独立完整性检查拒绝为可运行新应用。不能为了非空而编造业务。
- 原有 JSON-only、精确键、全局唯一 ID、单绑定、实体内字段、必填字段、number 聚合和 select 约束保留；不输出包装对象、脚本或协议扩展。

## 独立完整性与需求满足检查

`checkGeneratedApplication(spec, options?)` 不修改 Spec、Runtime 或旧应用，返回三个互相独立的结果；没有把三者合并成含糊的成功标志：

1. `structure.valid`：只调用现有 `assertAppSpec`。非法结构时语义评审为 `not-evaluated`。
2. `completeness.valid`：新生成应用需有实体、积木和字段；实体有绑定，初始空数据可以通过 form/list 录入，字段可以被输入界面操作。metric-only 的空应用没有数据入口，因此不能作为完整生成应用。该规则**没有写入基础验证器**；旧 Demo 和旧接口仍可接受其原先合法的结构。
3. `requirements.status`：`needs-review / satisfied / partial / unsupported / invalid-review`。没有独立评审时必须为 `needs-review`，不能从合法结构或名称相似推断满足需求。

调用方只有在 `structure.valid && completeness.valid && requirements.status === 'satisfied'` 时才能宣称完整满足需求；`needs-review` 不是成功，`partial` 也不是完整满足。三层结果分别报告，不能只检查前两个布尔值便宣称业务成功。

调用方从原始需求独立拆解 `requirements`，每项包含唯一 `id`、需求原文 `quote`、具体 `goal`、`primary` 布尔值（至少一个主要目标）。不能从生成结果反推一份恰好满足的需求。外部人工或独立模型评审给出逐项状态、业务关联解释、限制和 evidence。

每条 evidence 精确引用 `{blockId, entityId, operation, fieldIds}`。检查器核对真实绑定和 Renderer 操作：form 仅 create；list 为 create/read/update/delete；metric 为 count/sum/average。list 的编辑字段包括展示字段及必填字段；不能声称它可编辑隐藏的可选字段。所有积木、字段都要有目标依据，未评审目标、无关积木、未解释字段、非法操作或引用均不能通过评审证据检查。

`generationReviewContext()` 用需求原文、Spec SHA-256 和需求拆解 SHA-256 绑定评审，避免意外复用过期结果。摘要基于 JSON 序列化；即使语义相同，键顺序变化也可能要求重审。摘要不是签名，不提供授权。

`buildGenerationReviewMessages(idea, spec, requirements)` 为独立评审者准备 system/user messages，包含原始目标、Spec、实际操作 inventory 和上述上下文。**此函数只构造文本，不发送请求。** 评审 Prompt 要求比较业务意义、指出遗漏与未支持行为，不按领域词表判断。

```js
import {
  checkGeneratedApplication, buildGenerationReviewMessages,
} from '../server/aiGenerationQuality.mjs'

const initial = checkGeneratedApplication(spec, { idea, requirements })
// initial.requirements.status === 'needs-review'，并非满足需求。
const messages = buildGenerationReviewMessages(idea, spec, requirements)
// 由独立人工/评审系统另行评审；本模块不会自动请求另一次付费生成。
const report = checkGeneratedApplication(spec, { idea, requirements, review })
```

语义结论来自外部评审。本模块验证其覆盖、引用和真实 primitive；不能用确定性代码证明自然语言解释正确，也不能保证独立需求拆解没有遗漏。若评审者把错误业务映射到合法 CRUD 操作，引用校验本身无法识别所有谎报。应审阅具体解释和主要目标，不能只看 `satisfied`。评审结果保持在外部，不向 AppSpec 根对象增加字段。

## 后续如何接入 DeepSeek 路由（本阶段未执行）

部署负责人审阅后，在其最新 `server/index.mjs` 上自行接线，避免覆盖部署改动：

```js
import { buildGenerationMessages } from './aiGenerationPrompt.mjs'
// 仅把现有请求体中的 messages 替换为：
messages: buildGenerationMessages(idea)
```

这会替换原先的硬编码 `SYSTEM_PROMPT` 构建，但仍从同一份 AppSpec 源码导出约束。独立模块不依赖 Phase A 的 semantic recipes；新应用可动态创建任何合法业务实体。

保留现有 endpoint、模型配置、JSON mode、token/字节限制、超时、取消、限流、输入检查、finish_reason 检查和 `assertAppSpec`。成功仍返回原始 AppSpec，失败仍返回 `{error:{code,message}}`；不能把质量报告包装到原响应中。

如采用新应用完整性门禁，在解析且 `assertAppSpec(spec)` 成功后调用 `checkGeneratedApplication(spec)`，仅对新生成链路检查 `structure.valid` 与 `completeness.valid`，失败可映射现有 502 `AI_INVALID_SPEC` 和安全错误消息；不要把内部明细或上游文本泄漏给客户端，也不要强化基础协议验证器。

需求满足评审是另一个阶段：使用独立需求拆解与评审，保留 `needs-review/partial/unsupported` 区分。没有独立评审就不能宣传需求已完整满足。是否另加模型评审调用及如何向用户展示部分支持，需要后续单独接入；本阶段没有自动第二次付费请求。原前端只在新结果成功初始化后替换 Runtime，任何失败继续保留旧应用与记录。

## 离线验证（2026-10-18）

| 需求 | 手写结果中的差异 |
| --- | --- |
| 社团报名管理 | 1 个报名实体，form + list，无统计 |
| 健身训练记录 | 1 个训练流水实体，list + sum + average，无独立 form |
| 健身资料维护（同领域不同目标） | 2 个独立实体：动作/器械；2 个 list；字段与训练流水不同 |
| 个人收支记账 | 收入/支出 2 实体，各自 list + sum；无跨实体余额公式 |
| 校园失物招领 | 遗失/拾获 2 实体，各自 list，人工维护，无自动匹配 |
| 书籍阅读记录 | 1 个书籍实体、1 个 list；书名/作者/读完日期/读后感 |
| 用户临时指定：制作记录看过的电影的软件 | 1 个电影实体、1 个 list；电影名及可选观看日期/笔记 |

这些结果是人工编写的离线模型输出契约，**不是 DeepSeek 实际生成结果，也不构成线上通用生成质量已验证的证据**。它们检验 Prompt 构建契约、允许的结构差异、需求评审接口和当前应用运行能力；不应进入生产规则。

- `npm run test:generation`：**20/20 通过**，包括原路由接收 7 种结果及旧空结构，错误后恢复，Prompt 对每个需求使用同一 system 文本，引用/绑定/字段/未支持能力边界；7 例均执行真实 Runtime 创建、更新、删除和数值统计。
- `npm test`：**120/120 通过**（包含 main 已合并的 Phase A 与文本兼容修复测试）。
- `node --test tests/ai-quality/*.test.cjs`：**83/83 通过**，复核 main 已合并的质量验收套件。
- `npm --prefix server test`：**23/23 通过**，全部注入 mock upstream。
- `npm run build`：通过 TypeScript + Vite 构建。
- `npm run test:generation:browser`：**通过**。Chromium 中渲染 7 个应用、通过真实字段控件录入并检查统计；电影记录编辑/删除、HTTP 失败/非法 Spec/网络失败保留旧应用与数据、重试成功。**11 个 API 请求全部拦截**。
- 仓库原 `scripts/ai-create.browser.test.cjs` 另行运行时因假定生成后直接为 C 模式而在第 67 行等待表单提交按钮超时；当前 Workshop 默认 B 模式。旧脚本未能继续验证其后续 CRUD/错误恢复断言，这不是模型生成失败的证据；新增测试显式点击 C 模式后验证上述行为。后续应在独立修复中让旧脚本在生成后（包括成功重试后）显式进入 C 模式，并按当前折叠的重新生成入口操作，再重跑旧验收；不修改 Workshop 默认模式。本 PR 不修改旧脚本或产品组件。

浏览器测试需已有 Playwright 和 Chromium；没有为其增加项目依赖或 lockfile。本机运行方式：

```sh
NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules npm run test:generation:browser
```

## 实际可运行范围

可以运行：手动记录管理、独立对象资料维护、突出录入表单、列表增删改查、全部记录条数及单数值字段合计/均值。上述领域只要目标可用这些操作表达，就可以建模；不是领域白名单。

仍不能实现：计时器、日历排程、发送消息、支付、地图、文件上传、账号权限、多人共享、跨设备持久化、自动匹配/工作流、实体关联、筛选排序、条件/区间聚合、余额公式、完成率、自动生成内容。保存日期、联系文本、数值或状态不代表拥有这些行为；改标题也不会获得能力。

## Git 与协作状态

- G1 开工时通过 GitHub connector 核实 PR #10 已合并，基线为 `3e4a498c5c429cdb6d6b1e04a1022c3caaa18fa9`。正式 PR 复查时远端 main 已合并 PR #11、#12，为 `acd6ffbee2ff60ca5f228cbebadd6215c5504eda`。Git HTTPS 读取缺少本机凭据，通过已认证 connector 获取远端对象并核验 Git SHA，只将 G1 分支 fast-forward 至该基线；8 个未提交文件同步前后逐字节一致，本地 main 未移动。
- 基于该 main 新建独立 worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-general-generation`；分支 `feature/general-ai-generation`。
- 开工时发现质量测试 worktree 有已暂存文件，全程未编辑、重置或暂存其他 worktree 的文件；并行工作可能自行推进其分支。
- `server/index.mjs` 在新 worktree 与原 main 中 SHA-256 均为 `ca4a81d255d47776194bd94ba1c37ff0d008dd08a7e5d81f0b54109b9d82cabd`，本阶段没有触碰。
- Tech Lead 已批准本分支精确提交上述 8 个文件并发布目标为 main 的独立 PR；合并、生产路由接入与部署不在批准范围。没有调用付费 API，也没有进行真实 DeepSeek 生成测试。依赖仅在新 worktree 的被忽略 `node_modules/` 中链接既有本机依赖。

PR 创建后停止，等待 Tech Lead 代码审核。
