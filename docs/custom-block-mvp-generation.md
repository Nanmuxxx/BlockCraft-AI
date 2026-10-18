# CustomBlock MVP 第一批：源码生成与待构建制品

状态：第一批可审核，默认关闭。未连接 B/C，不具备构建或运行准入。本文不替代 Phase 1A 架构及 Phase 1B 隔离诊断。

## 基线与范围

- GitHub 确认 PR #16 已合并；开发基线为 `ecf7000dcb0015f7d9c2b895f6fdd3957ff70449`。交付复核时最新 main 为 `65e1f813949ceb1bc74064d338a04f99351c244e`，在该基线上前进 2 个提交。
- main 的新增差异为 `docs/mochi-phase-a-host.md`、`src/integrations/mochi/{host.ts,host.test.cjs,mockPlanner.ts}` 和 `package.json`，与本批 16 个路径没有重叠。保留开发历史，不擅自 rebase、reset 或合并 main；合并冲突及 CI 以 PR 的实际检查结果为准。
- 新工作树 `BlockCraft-AI-custom-block-mvp`，新分支 `feature/ai-custom-block-mvp`。
- HTTPS Git 凭据不可用，因此通过 GitHub connector 读取已合并提交，并重建其原始签名 commit 对象；写入对象库前逐字节计算 Git SHA-1，与上述提交匹配。没有改动 main、旧分支或旧工作树。
- 所有修改均为新增文件：`server/custom-block/` 11 个、`tests/custom-block-generation/` 4 个及本文，共 16 个。没有修改 package/lockfile、`src/`、旧文档、Demo 或品牌文件。
- Tech Lead 已授权精确提交这 16 个文件、普通非强制发布独立分支并创建目标为 main 的 PR。命令行 Git 缺少 HTTPS 认证时使用已连接的 GitHub Git-data 接口，核对本地/远端 tree、父提交及提交 SHA；不改写现有历史。未授权合并、部署、调用真实 DeepSeek 或执行生成源码。完成交付后等待审核，第二批构建执行、第三批 UI 均未开始。

## 精确源码增量

| 新增文件 | 职责 |
| --- | --- |
| `server/custom-block/protocol.mjs` | 加载固定可信协议模块、请求契约、限制及错误码 |
| `server/custom-block/tsconfig.json` | 独立编译已有可信 Phase 1A 模块；不接收生成源码 |
| `server/custom-block/build-protocol.mjs` | 用已有 TypeScript 5.9.3 检查并编译可信协议；不安装依赖 |
| `server/custom-block/.gitignore` | 忽略可信协议产物和本地待构建存储 |
| `server/custom-block/policy.mjs` | 服务端固定依赖、SRI 声明和构建约束 |
| `server/custom-block/import-policy.mjs` | 有界源码语法及静态 import 准入 |
| `server/custom-block/contract.mjs` | 通用提示词、模型输出验证、真实协议摘要 |
| `server/custom-block/provider.mjs` | 显式授权后可用的服务端 DeepSeek HTTP 适配器 |
| `server/custom-block/store.mjs` | 私有目录中的不可变惰性 JSON 制品、摘要复核及 Registry 适配 |
| `server/custom-block/generator.mjs` | 默认关闭的需求→生成→验证→保存编排 |
| `server/custom-block/live-generate.mjs` | 未来单独授权后的真实调用 CLI 入口；本轮只测试拒绝分支 |
| `tests/custom-block-generation/fixtures.mjs` | 三种需求的手写 Mock 响应，未执行、未编译 |
| `tests/custom-block-generation/contract.test.mjs` | 请求、Schema、源码/import 边界、摘要及三样本差异 |
| `tests/custom-block-generation/provider.test.mjs` | Mock HTTP、双门禁、限长、超时、错误脱敏 |
| `tests/custom-block-generation/pipeline.test.mjs` | Mock 全链路、保存/读取/防覆盖/损坏、无执行副作用 |
| `docs/custom-block-mvp-generation.md` | 当前交付、复现步骤、实际证据及后续阻塞 |

## 生成契约

服务端 API（当前没有 HTTP 路由）接收严格对象：

```ts
type GenerationRequest = {
  contractVersion: 1
  requestId: string     // Phase 1A ID 规则
  definitionId: string  // 可信调用方分配；必须与模型输出匹配
  requirement: string  // 非空，最多 4000 UTF-16 代码单元
}

type ModelOutput = {
  contractVersion: 1
  manifest: CustomBlockManifest
  sources: Record<string, string>
  dependencies: Array<'react' | 'react-dom'>
}
```

Manifest 必须直接返回 `propsSchema`、`stateSchema`、固定 SDK/协议版本和入口。第一批额外收紧为 `events:{}`、`requestedCapabilities:[]`，禁止请求 Runtime 写权限。模型不返回可信摘要、工具链、依赖版本或完整 npm 元数据。未知属性、非法 Schema、缺失入口、ID 不匹配均拒绝。Schema 仍是 Phase 1A 的受限对象/标量语言，不支持数组、null、默认值或 `$ref`。本批没有生成初始 props 或第二份共享状态；后续创建实例前必须由可信宿主提供并验证配置。

生成器没有需求分类器或业务模板。用户需求始终放在独立 user message；system message 只描述协议与边界。模型必须编写组件逻辑，但协议校验不能证明原创性、需求完成度或逻辑正确性。当前结果固定标记 `requirementsReview:not-performed`。

可信服务端把允许的依赖名称转换为固定版本/SRI，加入固定构建约束，形成真正的 Phase 1A `SourceArtifact`，调用原版 `assertSourceArtifact`、`computeVersionDigest`。Phase 1A 无改动、未放宽 AppSpec v1，也没有增加可写 Runtime 或项目 revision。

摘要计算继续使用：

```text
sha256(UTF8("blockcraft:source-artifact:v1\n" + canonicalJson(artifact)))
```

规范 JSON 使用排序的 UTF-16 对象键、原数组顺序及 JSON 标量编码；覆盖 Manifest、源码、依赖与构建约束。结果是内容身份，不是签名、可信来源证明或运行授权。请求 ID、需求摘要和供应商标签不进入制品版本摘要；同一内容保留首次保存的 provenance。

## 静态准入与大小限制

- 最多 8 个 `.ts/.tsx` 文件，每个最多 65,536 UTF-8 bytes，总量最多 262,144 bytes；不接收 `.d.ts`、CSS、JSON、资源、package 文件或构建脚本。
- 使用已有 TypeScript 5.9.3 作为可信**语法解析器**，不转译、类型检查、链接或执行模型源码。解析前限制 token 数 24,000/文件及词法括号深度 96；解析异常按失败处理。
- entry 要有默认导出候选；这不是 React 组件类型/行为正确性的证明。
- 只允许静态字面量 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`，以及不逃逸制品且唯一解析的相对 TS 模块。所有文件必须从 entry 可达。
- 拒绝未知包、URL、node 模块、路径逃逸/编码路径、缺失/歧义文件、动态 import、import-equals/type-import、import attributes、三斜线引用；拒绝直接出现的 require/eval/Function/Worker 等标识符。
- 上述静态检查可以发现常见错误，**不构成恶意代码分析或隔离**。计算属性、别名、DOM/网络 API 等不能靠这套 AST 规则证明安全；本批对所有源码拒绝执行。
- 原 Phase 1A JSON/Schema 深度、节点、属性和字符串限制仍生效。模型文本上限 393,216 bytes，HTTP envelope 上限 1,048,576 bytes。
- JSON 文本由标准 `JSON.parse` 解码，再由真实协议验证；重复 JSON 对象键遵循标准解析的最后值语义，不宣称具备重复键取证功能。

React/ReactDOM 固定 `19.3.1`，SRI 与基线 lockfile 一致；esbuild 固定 `0.25.12`，SRI 来自 2026-10-18 对官方 npm registry **元数据**的只读查询。没有下载/安装 esbuild，也没有校验包 tarball 或可执行文件字节。SRI 声明及摘要一致均不等于真实工具链/供应链验证。

## 服务端调用与保存

`createGenerator({enabled:false})` 默认先拒绝请求，不触碰 provider/store。实验调用方必须显式传入 `enabled:true`。真实 provider 还要求 `allowPaid:true` 和显式服务端密钥；不自动读 `.env`，不把密钥放进 prompt、返回对象或存储。

HTTP 端点固定为 `https://api.deepseek.com/chat/completions`，禁止跳转；默认模型沿用基线的 `deepseek-v4-flash`，可选 `deepseek-chat`。模型可用性及契约遵循度本轮**未经真实接口验证**。一次请求、无自动重试，最多 8192 输出 token、30 秒连接与读取总 deadline；按流读取并实施 byte 限制。截断、拒绝、tool call、非法 UTF-8/JSON、错误状态均拒绝，错误不回显响应正文或密钥。

```text
自然语言请求
  → 默认关闭门禁
  → 通用 prompt + provider（本轮仅 Mock）
  → 受限输出 + Manifest/Schema/import 检查
  → Phase 1A 完整制品摘要
  → pending-build JSON
  → 返回精确 reference；build:not-attempted、execution:denied
```

存储严格格式：

```ts
type PendingRecord = {
  storageVersion: 1
  status: 'pending-build'
  entry: RegisteredArtifact
  provenance: {
    kind: 'mock' | 'deepseek'
    requestId: string
    requirementDigest: `sha256:${string}`
  }
}
```

需求摘要是 SHA-256(`blockcraft:requirement:v1\n` + 原需求 UTF-8)；原需求不持久化。源码仍可能包含用户输入的敏感信息，实际接入前需要宿主的数据策略。provenance 是可信调用方的审计标签，未签名，不能充当供应商真实性证明。

存储目录必须在可信服务端私有位置、web root 之外；目录 0700、文件 0600，使用纯摘要 JSON 文件名。先写独占临时文件并 fsync，再用 hard-link 原子发布且不覆盖；无源码 JS/TS 文件导出。写入前复制、验证并复算摘要，读取时拒绝符号链接/非普通文件、限制 524,288 bytes 并复算摘要。通过 `resolve(ref)` 实现 Phase 1A Registry；项目实例继续只保存引用和经 Schema 验证的 props。

存储只接受合法 Phase 1A 惰性制品；读取并不签发新一轮生成准入或执行许可。不要把目录给用户写，不应公开文件为可执行模块。父目录及本机用户属于信任边界；本地其他可信进程仍可修改/删除文件。摘要检测篡改，不能阻止删除。计数上限默认 256、并发门禁为每个 generator 单实例；目录计数不是跨进程磁盘配额或事务锁。生产前需全局队列、磁盘配额、生命周期清理、目录 fsync/崩溃恢复及持久化服务评估。

## 离线复现与未来真实入口

使用仓库已有固定依赖，不增加 npm 包或执行安装脚本：

```sh
# 必须先编译可信协议；这不编译生成组件。
node server/custom-block/build-protocol.mjs
node --test tests/custom-block-generation/*.test.mjs

node --test tests/custom-block/*.test.cjs tests/custom-block-sandbox/*.test.mjs
npm test
node --test tests/ai-quality/quality.test.cjs tests/ai-quality/business.test.cjs
npm --prefix server test
npm run test:generation
npm run build
```

Mock 的三个完整响应位于测试 `fixtures.mjs`；离线 pipeline 测试逐个生成、保存、检查、通过真实 Registry 读取，然后清理临时目录。可检查源码与 Manifest，但没有执行它们。本轮依赖使用已有本地依赖的链接，未运行 npm install/ci，也未改 lockfile。

未来独立授权后，操作员才可在服务端安全提供环境变量并运行 `node server/custom-block/live-generate.mjs`。所需变量：`BLOCKCRAFT_CUSTOM_BLOCK_ENABLED=1`、`BLOCKCRAFT_CUSTOM_BLOCK_ALLOW_PAID=I_HAVE_EXPLICIT_AUTHORIZATION`、`DEEPSEEK_API_KEY`、`BLOCKCRAFT_CUSTOM_BLOCK_REQUEST_ID`、`BLOCKCRAFT_CUSTOM_BLOCK_DEFINITION_ID`、`BLOCKCRAFT_CUSTOM_BLOCK_REQUIREMENT`；可选绝对私有目录 `BLOCKCRAFT_CUSTOM_BLOCK_STORE`。不要把密钥写进命令历史、文件或前端。该入口没有 HTTP 路由，运行成功也仅写 pending-build JSON，仍无法执行源码。双门禁只是配置保护，真实调用仍需另行获得人的授权。本轮未运行放行分支。

## 本批验证结果

| 检查 | 通过数/结果 | 证据边界 |
| --- | --- | --- |
| 新生成链路 | 82/82 | 全部 Mock、语法与数据测试；非真实 AI |
| Phase 1A 协议 | 137/137 | 原验证、迁移、摘要、消息回归 |
| Phase 1B 诊断 | 9/9 | 仍 fail-closed；没有隔离执行通过 |
| 原 `npm test` | 120/120 | 原 Runtime、UI 逻辑及模型回归 |
| AI Quality | 83/83 | 离线模型/业务回归 |
| 后端 | 23/23 | Mock 上游，无真实 API |
| 生成兼容 | 23/23 | 离线 AppSpec 兼容，不是代码执行 |
| 可信协议编译 | 通过 | TypeScript 5.9.3，仅已有可信代码 |
| 生产构建 | 通过 | 原主应用 tsc + Vite；没有生成源码进入构建 |

总计 477 项测试，0 失败、0 跳过。新增文件经独立 whitespace、JS syntax、JSON 配置及文档链接检查；普通 `git diff --check` 对 untracked 文件不构成检查证据，交付前逐文件检查并在精确暂存后运行 `git diff --cached --check`。

| 三个验收需求 | AI 真实生成 | 不同源码/Manifest | 真实编译 | 隔离交互 | B/C |
| --- | --- | --- | --- | --- | --- |
| 番茄钟 | 未调用 | 手写 Mock 通过 | 未尝试 | 未尝试 | 未接入 |
| 抽奖转盘 | 未调用 | 手写 Mock 通过 | 未尝试 | 未尝试 | 未接入 |
| BMI | 未调用 | 手写 Mock 通过 | 未尝试 | 未尝试 | 未接入 |

这三个样本没有进入生产提示词、分类器或降级分支，未宣称开始/暂停/继续、抽奖或计算交互已实测。

## 后续接口及阻塞（本轮不实施）

真实 DeepSeek 生成验收的最小方案：另行授权后，在服务端使用上述双门禁及私有存储，对番茄钟、抽奖转盘、BMI 各发送 1 个独立需求，共 **3 次付费请求**；不批量重试、不启用工具调用、不编译或执行返回源码。每次使用唯一 requestId/definitionId，输入 requirement 不超过 4000 字符、输出最多 8192 token，3 次合计输出上限 24,576 token，输入另计。实际价格、模型可用性及总费用需调用前按当时官方计费和输入 token 确认，本批没有估算货币金额或发生调用。任何超时、截断或不合规结果按失败记录，修复/重试需新的次数与费用授权。验收仅检查模型确实返回不同源码与 Manifest、Phase 1A 摘要可复算、pending-build 可读且无运行许可；需求行为和原创性另需人工审查。

第二批需要独立构建服务接受精确 `{definitionId,versionDigest}`，重新加载、复算并检查完整 SourceArtifact；源码信任级别必须是可信宿主分配的枚举，不能采信模型或项目中的 `trusted` 字段。构建结果需绑定源码摘要、实际工具链/镜像摘要、依赖字节校验、输出 bundle 摘要和真实隔离证据。pending-build 存储不能自行提升为 runnable。

当前仍没有经过验证的隔离 provider。未安装未知编译器、未构建/执行 AI 或手写样本、未部署服务。Linux 侧必须有可验证的构建与运行进程边界（容器/VM、只读挂载、无网络、无密钥、非 root、seccomp/capability 削减、cgroup CPU/内存/pids、父进程 deadline kill 与崩溃恢复）；需要实际恶意样本测试。ModelScope 能否提供这些能力仍未实测，不因“支持 Docker”推定通过。

第三批需要独立 Viewer 来源与 CSP、来源/会话/实例/版本身份校验及消息去重网关，再将获得运行准入的精确制品接入 C 模式；B/C 共用 v2 引用、props、布局。第一批不创建 Runtime 写命令、不实现 Viewer/消息网关、不更改任何现有 UI。Phase 1A 消息 Schema 验证仍不等于来源认证。

最大三个风险：

1. 真实隔离构建和执行仍缺席，全部源码必须持续拒绝执行；浏览器 iframe 无法单独提供可靠 CPU/内存硬限制。
2. 模型未真实验证，静态语法/Schema 合法不证明类型正确、行为完整或原创；需单独授权的真实输出采样、人工检查及隔离验收。
3. 包 SRI、provenance 及本地存储都是数据层基础，没有供应链签名、构建证明、会话身份或多租户配额；不能据此签发执行权限。语法解析本身也不是进程级资源隔离，后续服务化前需额外资源边界。
