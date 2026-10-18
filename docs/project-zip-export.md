# 独立 React/Vite 源码 ZIP 导出

状态：P0 独立模块、离线测试及固定可信样本验收完成；Tech Lead 已批准提交独立 Draft PR。当前交付仅供审核，没有产品下载按钮、生产 HTTP endpoint、合并或部署。没有执行任意 AI 源码或调用 DeepSeek。

## 基线与任务隔离

- 仓库 `Nanmuxxx/BlockCraft-AI`；独立 worktree `BlockCraft-AI-project-zip-export`，分支 `feature/project-zip-export`。
- 2026-10-18 开始时 GitHub API 确认 main 为 `2678c5e9c8dca05b79a45f37f0c4104b9cfc5cdc`，#27 已合并。Git CLI 当时缺少 HTTPS 凭据，使用已连接 GitHub API 核对本地 origin/main。
- 第一轮验收基线为 `5eca85e710cb1c5513961abfb7e45510ba339019`（#24 合并提交）。本轮先在 checkout 外备份全部 11 个新增文件、Git 状态、二进制 patch 和逐文件 SHA-256，再快进，复核 11/11 文件哈希未变；没有 stash、清理或覆盖成果。
- 当前验证基线为 `94262b3307274b2bae0ad5f7782cd7088228574f`（#25 合并提交）。GitHub API 确认与本地 origin/main 相同，#24/#25 均已合并。终端 fetch 缺少 HTTPS 凭据，复用了共享对象库中已有且经 API 核对的精确 main；未读取或复制凭据。
- #24 head `55fe03765da93582ec4d5878bcf860e32428a138`；#25 head `e76ab0f29aff7d45c558be85586f712d04b362ee`。现已直接读取 main 的 `CustomProjectSession`、`AppRuntime.customProject`、Workshop 和 registry 接口，并对真实会话完成只读导出与换版测试。开工时读取的旧 head `c87889046a80f09758cea51eb629d1058bfb9336` 仅作历史记录。
- 新增文件仅位于 `tools/project-zip-export/`、`tests/project-zip-export/` 和本文档/验收摘要。没有修改 Workshop、Runtime、统一 owner、CAS、Mochi、DeepSeek、Gateway、Viewer、package 或 lockfile。

## 输入、输出与执行边界

现有真实类型名为 `CustomProject`（`formatVersion: 2`），不是名为 `CustomProjectV2` 的新类型。`SourceArtifact.artifactVersion`、manifest 协议版本仍为 1。

```ts
import { exportProjectZip } from './tools/project-zip-export/export.mjs'

// ExportInput/Options/Result 声明见 export.d.mts。
const result = await exportProjectZip({
  project: validatedV2Snapshot,
  artifacts: exactRegisteredArtifacts,
}, { filename: 'my-application.zip' })
// result: { filename, bytes: Uint8Array, files: {path, bytes}[] }
```

这是 **Node 工具/可信服务边界**，复用现有 Node 静态 import parser；不能直接将该模块 import 进浏览器。没有新增依赖。一次显式输入只含普通 JSON 快照和已解析的 `RegisteredArtifact[]`，不接受磁盘路径、URL、Registry 回调、npm 脚本或“已验证”布尔旁路。

模块在首次 await 前校验并复制完整输入与选项。随后复用原始 `assertSourceArtifact`、`resolveArtifact`（含内容重算 SHA-256）和 `parseCustomProject`；每个实例都按 `definitionId + versionDigest` 绑定，禁止 latest 回退。缺失版本、内容摘要不符、props/结构/布局无效、重复或多余制品均失败，不返回部分 ZIP。同一定义的不同版本使用不同目录，同版本多实例复用源码。

`export.mjs`、`zip.mjs`、`templates.mjs` 不读写宿主文件、不联网、不启动进程、不动态 import/eval/编译/运行制品。TypeScript 仅作为受限静态语法/模块图解析器。源码始终是文本；测试中包含“导入即抛错”的源文本，导出时不会执行。单独的 `prepare.mjs` 只编译固定仓库协议；它不由导出器导入。验收脚本也不由导出器调用。

导出是只读操作：不增 revision、不持有可写项目副本、不创建第二 owner、不调用 CAS、不写 Runtime。

## 支持范围与明确拒绝

内置 AppSpec 的 form/list/metric：

- text、number、boolean、date、select 字段，配置字段顺序、必填规则、选项、初始记录和实体绑定。
- form 新增记录，list 显示/删除，metric 的 count/sum/average 随记录更新；空平均值为 0。
- 数据仅在本地组件内存中；刷新恢复导出时数据。没有数据库、远程同步或宿主 history/undo。
- DOM 顺序和 zIndex 遵循 `renderOrder`。桌面已保存归一化坐标映射至独立画布，未设置坐标的内置块排在坐标区域下方；<=700px 按 renderOrder 流式排列。原始位置在 data.ts 完整保留。布局不是编辑器的像素还原，已保存的重叠也不会被擅自重排；坐标区卡片最大高度 600px，可内部滚动。

CustomBlock 的导出准入 profile 为 `react-props-local-v1`：

- 默认导出的 React 组件，接收实例 props，可使用 React 组件本地状态；TS/TSX 静态相对模块图必须完整、可解析、全部可达，原始源码逐字保留。
- 仅接受现有 `PACKAGE_PINS` 中 React/react-dom 的准确版本及 SRI 声明；React 必须声明。导出 scaffold 固定 React 19.3.1、react-dom 19.3.1、TypeScript 5.9.3、Vite 8.3.4 和 @types，生成固定 dev/build/preview 脚本。
- 拒绝未知或未声明依赖、动态 import、require/eval/Function/Worker 等执行入口、外部 URL import、CSS/JSON/JS 制品、声明文件、缺失默认导出、逃逸/歧义路径、不可达源文件及静态语法错误。
- 拒绝声明状态属性、任何保存的宿主 state 槽（即使 value 为空）、events、capability 请求以及明确的宿主/存储/网络全局标识符。组件本地状态不会转换为宿主协议。

上述是保守的静态准入，**不是安全沙箱、执行许可、完整类型检查或任意 AI 代码可运行性的证明**。反射、计算属性、间接行为和业务错误无法靠这套扫描完整识别；摘要也只证明版本身份。任意用户制品不进入自动安装/构建/运行流程，不能将 ZIP 成功等同于第三方源码经沙箱认证。语义或类型错误仍可能由用户在自行审查后构建时发现；报告中的可构建证据仅针对固定可信样本。

package.json 不接受模型提供的脚本/依赖描述。不会复制制品 build 配置作为 npm script，也不会包含 BlockCraft SDK/网站 Runtime。SRI 仅用于核对版本准入声明，不代表导出器下载并验证了 npm 包。ZIP 不包含 node_modules 或预生成 lockfile；首次 npm install 后用户可保留 lockfile。

## ZIP 内容

```text
package.json
index.html
tsconfig.json
vite.config.ts
README.md
provenance.json                 # profile/revision/精确 definitionId + digest
src/
  main.tsx
  App.tsx
  model.ts
  data.ts                       # 完整已验证项目快照
  styles.css
  components/
    FormBlock.tsx
    ListBlock.tsx
    MetricBlock.tsx
    custom/a0/<原始 TS/TSX 路径> # 有 CustomBlock 时才出现
    custom/a1/...
```

纯内置工程 14 文件。混合固定样本 17 文件，包含真实 Counter.tsx、Temperature.tsx、convert.ts；不是 JSON/截图/HTML 壳。

相同输入产生逐字节相同 ZIP：规范 JSON、稳定制品目录、排序路径、UTF-8、STORE 无压缩、固定 1980-01-01 时间戳、CRC32；不写当前时间、随机值或机器路径。JSON 键插入顺序和制品输入顺序不改变结果，renderOrder 数组顺序保留。后续 npm 安装的传递依赖解析不属于 ZIP 字节确定性保证。

## 限额与隐私

| 维度 | 硬上限 |
| --- | ---: |
| ZIP 文件名 | 80 字符，ASCII 小写 slug + .zip，拒绝保留设备名 |
| 内部路径 | 240 字符，固定根文件/限定 src 子树，拒绝 .env、隐藏文件、绝对路径、盘符、反斜杠、穿越、保留名、大小写冲突 |
| 文件数量 | 256 |
| 单文件 UTF-8 字节 | 524,288 |
| 解压后总字节 | 4,194,304 |
| ZIP 总字节（含头） | 4,259,840 |
| 独立制品版本 | 32 |
| 制品源码合计 | 1,048,576 字节 |
| builtin + custom 总块数 | 128 |

同时沿用原 Schema/JSON 和 import parser 的更严限额：单制品 262,144 源码字节、最多 8 个静态 TS/TSX 文件、单源文件 65,536 字节、24,000 tokens、嵌套 96 等。完整输入受原 JSON 的 4,000,000 bytes、2,000,000 文本字符、深度32 等限制。`options.limits` 只能调低 ZIP 四项上限。ZIP 不接收已有压缩包、不压缩、不包含链接或宿主文件，尺寸在最终缓冲分配前核验。

只处理显式 JSON 与内存源文本，不搜索/读取 .env、Key、Token、Cookie、日志或任意宿主路径。已知密钥前缀、凭据赋值、Bearer、环境引用、常见宿主私有绝对路径会拒绝。此文本防线不是通用秘密识别器，不能保证识别所有编码/任意格式凭据。分享者仍需审查项目自身记录与源码；README 明确告知导出包含已存记录和 props。

## 稳定错误码

失败时抛出 `ProjectExportError`，UI 应按 `code` 显示原因并结束下载；不要返回空 ZIP 或将部分失败显示为成功。

| code | 原因 |
| --- | --- |
| INVALID_INPUT / INVALID_OPTIONS | 非普通 JSON、输入/选项键非法 |
| INVALID_FILENAME / LIMIT_CONFIG | 文件名非法或试图放宽硬限额 |
| INVALID_PROJECT | 现有项目结构、props Schema、坐标或 renderOrder 校验失败 |
| INVALID_ARTIFACT | 源码制品 Schema/Manifest/build 契约非法 |
| VERSION_MISSING / DIGEST_MISMATCH | 精确版本缺失或重新计算的绑定/内容摘要不符 |
| UNSUPPORTED_DEPENDENCY | 非固定 allowlist 的包、版本、SRI 或缺失 React 声明 |
| UNSUPPORTED_SOURCE | 语法、入口、源文件类型、静态 import 图或执行原语不受支持 |
| UNSUPPORTED_PROTOCOL | 声明事件/宿主状态/能力、保存状态槽或宿主全局协议不受支持 |
| PRIVATE_CONTENT | 命中已知私密配置/密钥/宿主路径文本模式 |
| DUPLICATE_ARTIFACT / UNUSED_ARTIFACT | 重复制品或与快照无关的额外制品 |
| OUTPUT_PATH / OUTPUT_COLLISION | ZIP 路径非法或冲突 |
| FILE_COUNT_LIMIT / FILE_SIZE_LIMIT / TOTAL_SIZE_LIMIT / ZIP_SIZE_LIMIT | ZIP 文件数量/单文件/总解压量/含头体积超限 |
| ARTIFACT_COUNT_LIMIT / SOURCE_SIZE_LIMIT / BLOCK_COUNT_LIMIT | 制品数量/源码合计/积木数量超限 |
| LIMIT | 原 JSON/Schema 限额超出 |
| STALE_SNAPSHOT | 仅接入样例：下载准备期间唯一 owner 已替换快照 |

`UNSUPPORTED_SOURCE.reason` 可提供原静态 parser 的受限代码，例如 SOURCE_SYNTAX、IMPORT_REJECTED、UNREACHABLE_SOURCE、ENTRY_EXPORT、SOURCE_LIMIT。错误不包含原始源码、凭据或任意异常堆栈文本。稳定主错误码不依赖 parser 原始消息。

## 与 #24 / #25 的最小接线

`integration.example.mjs` 是可测试的 Node 只读接入样例：

```js
import { exportSessionSnapshot } from './tools/project-zip-export/integration.example.mjs'

// 已合并的 CustomProjectSession：getSnapshot() + registry。不创建会话。
const { filename, bytes } = await exportSessionSnapshot(existingSession, {
  filename: 'my-application.zip',
})
// 未来经受控传输层返回 application/zip；浏览器建立 Blob、下载并 revoke URL。
```

它从唯一 owner 捕获一次快照并复制，去重精确引用，用原 resolveArtifact 校验 Registry 的当前版本制品，送入纯核心再完整校验，最终比较 owner 快照对象身份。相同 revision 的另一会话也判过期，不重试、不重新读取后混合新旧数据。更简单的调用者可直接使用 `{project, artifacts}` 导出指定历史快照；核心并不声称它仍是用户当前会话，latest-only 策略由样例负责。

#24 的 `getAuthorization()` 与同步三参数 `compareAndSwap(expected,next,authorization)` 保持原契约；导出不调用它们、不绕过写授权，也不会因导出改变项目 revision。只读会话可以导出可读快照，具体下载/数据访问权限仍由可信宿主决定；只读写凭据不是数据访问授权。

正式 Workshop 已通过 `runtime.customProject` 使用 #25 的唯一 `CustomProjectSession`，导出接入点为该现有对象；其 registry 只按准确引用读取不可变制品，`getSnapshot()` 返回完整冻结 v2。新增测试先用正式 install 准入固定样本，再在只读状态导出，断言 v1 投影/v2 快照/授权身份、revision 和通知数均不变；换版后仅导出当前 digest，历史 registry 条目不会混入 ZIP。测试 setup 的 install 不属于导出流程。

产品层仍需选定可信打包服务或单独 worker bundle，施加入口请求限额和现有身份/读取权限，将完整 JSON+精确制品发往此边界，然后下载字节。浏览器不能直接 import 本 Node 模块。该传输层、真实按钮、取消/过期 UI、安全 Viewer 和生产 Gateway 均未在本任务接线；样例不是生产 HTTP handler。不能转回 v1 或从独立可写 AppRuntime 获取 base 后拼装 v2。

## 复现与验收证据

已安装仓库依赖的环境，Node.js >=22.16，先显式编译固定协议（输出 ignored .generated，且写入正确的 commonjs 包标记）：

```sh
node tools/project-zip-export/prepare.mjs
node --test tests/project-zip-export/export.test.mjs
npm test
node --test tests/custom-block/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block-workshop/*.test.cjs
node node_modules/typescript/bin/tsc -b --force
npm run build
```

本轮 #25 合并后新 main 基线：导出专项56/56、主测试158/158、CustomBlock+B/C+Workshop224/224 通过（含原 CustomBlock+B/C201 项），强制 TypeScript 检查及主工程 tsc/Vite 构建成功。专项覆盖 builtin、真实 TSX、同一定义多版本/同版本多实例、配置/排序/布局、完整 ZIP+CRC、摘要拒绝、Schema 拒绝、私密模式、路径/数量/UTF-8/总量上限、输入不变/并发调用者变更、无网络/不执行源码、逐字节确定性、未知依赖/状态协议拒绝，以及过期只读接入和正式唯一会话兼容性。

固定样本验收需开发机已有 Playwright/Chromium；缺少时应报告环境缺失，不安装或自动扩大信任集合：

```sh
# 若 Playwright 位于宿主测试目录，显式设置 NODE_PATH 指向已有包目录。
node tests/project-zip-export/accept-trusted.mjs
```

验收脚本不接受参数、输入路径或模型响应，只允许仓库已有 `trusted-samples.mjs` 的人工 catalogue，重新核对固定源码 SHA-256 与完整制品相等后才构建。三个固定输入为社团报名、混合 Counter/Temperature、阅读记录+平均值。输出位于新建系统临时目录，远离可信应用源码树。npm 使用固定公共 registry、独立临时 cache、空用户/全局配置、禁用安装 lifecycle scripts 和最小环境。只对固定 scaffold 执行一次 npm install，另外两工程复用依赖。

三工程 npm run build 均成功；Vite dev 与生产 preview 均在真实 Chromium151 下验证 renderOrder、表单/列表/删除、count/sum/average/空统计、Counter7→8→reset7、Temperature100→212°F、桌面坐标、无坐标防遮挡，以及与 Object.prototype 属性同名的合法 ID/缺失记录/可选空单元格；650px/1366px 各截图，共12张。非本地 HTTP 请求和页面异常均为0。另对固定混合样本执行 npm run dev，确认回环 HTTP 200 后关闭进程。安装只证明固定已审查样本，未对任意 AI 源码执行安装、构建或运行。

机器摘要见 `project-zip-export-verification.json`；临时输出含三个可安装源码 ZIP、详细报告和截图。审核前可按摘要 SHA-256 独立核对 ZIP，Python 标准 zipfile 的 CRC/必需文件/尺寸核查亦已完成。本文不把临时依赖、日志、私有机器路径或截图打入用户工程。

## 交付审核点

P0 核心以独立 Draft PR 交付，Tech Lead 已明确授权本轮提交；完成后停在审核点，不自动合并或部署。P1 下载按钮及 /ai-create 接线留待产品集成任务；高级依赖/宿主状态协议属于后续支持，不能静默降级。尚未完成任意 AI 代码的安全隔离执行，导出完成不能替代该工作。
