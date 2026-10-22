# 项目包 v1 QA 证据

日期：2026-10-22（Asia/Shanghai）。工作树：`BlockCraft-AI-project-package-v1`。

## 修改边界

- `tests/project-package/fixtures.cjs`：固定、可解码的 2×2 RGBA PNG；图片画廊、已有记录、布局坐标、渲染顺序、暂停计时器和裸 v1 项目 fixture。
- `tests/project-package/acceptance.test.cjs`：统一文件入口跨模块测试，ZIP/JSON/旧项目恢复后实际写记录与计时交互，错误版本/大小谎报/无效字节/预读上限拒绝。
- `tests/project-package/browser.cjs`：使用实际 UI 下载与导入；源浏览器上下文销毁后在全新上下文恢复，资源 decode、预览、渲染顺序、运行、完整再导出与失败原子性。
- `tests/gallery/browser.cjs`：按总负责 Agent 明确授权，仅修复现有 1×1 PNG fixture 的错误 IDAT CRC，像素、尺寸和既有测试断言保持不变。
- 本报告。未修改生产代码、服务、部署配置、魔塔链接或远端状态；未提交、推送或部署。

## 可复现环境

- Node.js `v24.22.0`；npm `11.19.1`；TypeScript `5.9.3`。
- Playwright `1.64.1`；Chromium `156.0.8078.4`（macOS arm64）。
- 浏览器命令的本地环境前缀：

```sh
NODE_PATH=/Users/nanmuxun/BlockAI/modelscope-json-release-20261022/node_modules \
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Users/nanmuxun/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
```

Playwright 是现有工作区共享安装，不新增依赖。旧源码 ZIP / gallery 服务测试要求先生成固定仓库模块；总负责 Agent 已运行以下本地前置命令并确认退出 0：

```sh
npm --prefix server run build
node server/custom-block/build-protocol.mjs
```

## 最终执行结果

| 命令（浏览器命令加上上述环境前缀） | 结果 |
| --- | --- |
| `npm test` | 224/224 通过，退出 0 |
| `npm run test:project-json` | 6/6 通过，退出 0 |
| `npm run test:layout-order` | 33/33 通过，退出 0 |
| `npm run test:project-package` | 35/35 通过，退出 0；含格式、ZIP、安全、旧入口、实际图片解码 gate 与释放资源 |
| `node --test tests/project-zip-export/*.test.mjs tests/gallery/server.test.mjs tests/project-package/acceptance.test.cjs` | 84/84 通过（源码 ZIP 67、gallery HTTP 14、新入口 3），退出 0 |
| `node tests/project-package/browser.cjs` | 全部通过，退出 0；外网请求 0、AI 调用 0、页面错误 0 |
| `npm run test:project-json:browser` | 全部通过，退出 0；旧 JSON 下载、刷新恢复、替换备份、备份下载/恢复与失败保留记录 |
| `node tests/gallery/browser.cjs` | desktop/mobile 全通过，退出 0；外网请求 0、页面错误 0；原 React 源码 ZIP 均 40,444 bytes |

根 Agent 负责最终构建；QA 已独立执行表中包格式/ZIP/安全全套，本报告不冒充构建门禁的执行结果。

新浏览器验收的具体断言：

1. 1280px 源上下文导入固定 JSON，C 模式显示记录、图片和暂停计时；图片 `decode()` 成功、宽高均 2，预览支持 Escape 与焦点恢复。
2. 真实下载项目 ZIP；Node 侧解析后的 CustomProject 与初始快照完全相同，ZIP 资源 bytes 与 fixture PNG 完全相同。
3. 销毁源上下文；390px 全新上下文初始 localStorage 和项目备份均为空，仅把下载 ZIP 带入。导入后 C 模式图片可解码和预览、记录/坐标/计时状态/渲染顺序保持；再次导出项目和所有 ZIP 文件内容完全一致。
4. 恢复项目能开始/暂停计时、提交新记录，证明运行状态真实可写。
5. 缺失图片、损坏资源、`../evil.json` ZIP 路径、超过 ZIP 总上限、非法 JSON、重复 JSON 键均显示“当前项目未更改”。另破坏 PNG IDAT、保留 PNG 签名，并重新计算 manifest SHA256/长度和 ZIP CRC；浏览器解析明确返回 `RESOURCE_INVALID`，UI 同样拒绝。每次都保留运行中的新记录、备份数量不增加；失败前后导出的 JSON 完全相同。
6. 裸 AppSpec v1 项目导入后保留旧记录、正常运行，并能再导出符合 v1 包契约的 ZIP。

所有新测试使用固定 AppSpec 和资源，不读取凭据，不调用真实 AI。浏览器阻断外网；原 gallery/JSON 浏览器回归对同源 API 使用固定离线响应。临时 ZIP/JSON 仅位于系统临时目录，测试结束清理；报告不包含资源内容、凭据或带凭据的 URL。

## 排障与修正记录

1. 只读检查发现本工作树没有 `node_modules/playwright/package.json`。Node 官方模块解析文档 <https://nodejs.org/api/modules.html> 与现有工作区安装核实后，使用上面的 `NODE_PATH`；未安装依赖、未修改认证。最初命令 `ls node_modules/playwright/package.json node_modules/typescript/package.json` 退出 1：`ls: node_modules/playwright/package.json: No such file or directory`。修正后浏览器启动成功。
2. 源码 ZIP/gallery 回归首次执行退出 1，Node `v24.22.0` 报两项：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/nanmuxun/BlockAI/BlockCraft-AI-project-package-v1/server/.generated/appSpecValidation.js' imported from /Users/nanmuxun/BlockAI/BlockCraft-AI-project-package-v1/server/trusted-interactive.mjs
code: ERR_MODULE_NOT_FOUND
url: file:///Users/nanmuxun/BlockAI/BlockCraft-AI-project-package-v1/server/.generated/appSpecValidation.js

Error: Cannot find module './.generated/custom-block/index.js'
Require stack:
- /Users/nanmuxun/BlockAI/BlockCraft-AI-project-package-v1/server/custom-block/protocol.mjs
code: MODULE_NOT_FOUND
```

联网检索服务返回空错误；直接只读访问 Node 官方错误文档 <https://nodejs.org/api/errors.html#err_module_not_found> 成功。核对 `server/package.json`、两个 `tsconfig.json` 与 `build-protocol.mjs` 后确认缺少本地生成模块，交由总负责 Agent 顺序编译。前置编译后同一回归命令 84/84 通过，非产品故障。

3. 新 browser 首跑退出 1：Playwright `strict mode violation`，`getByRole('status')` 同时匹配 `<output aria-label="剩余时间">` 与 `<p role="status">计时中</p>`。先保留错误与 Playwright `1.64.1` 版本，联网只读核对官方 <https://playwright.dev/docs/locators#strictness>，确认应使用唯一 locator。测试改成无 accessible name 的 `status` 精确定位，后续两次浏览器运行通过，非运行时故障。
4. 新 Node 入口测试首次误把 `dispatch(create)` 参数写为顶层 `values`，退出 1：`Error [AppSpecError]: Expected object`、`code: VALIDATION`。只读检查 `RecordChange` 明确要求 `{record:{id,values}}` 且 `dispatch` 返回 void；按现有公开类型修正 fixture 调用，3/3 通过。未改动产品 API。
5. 浏览器实际解码门禁接入后，再跑原 gallery browser 在刷新导入 JSON 时退出 1，原始错误为：

```text
ExpectError: expect(locator).toBeVisible() failed
Locator: getByRole('heading', { name: '离线图片画廊', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found
Call log:
  - Expect "toBeVisible" getByRole('heading', { name: '离线图片画廊', exact: true }) with timeout 5000ms
  - waiting for getByRole('heading', { name: '离线图片画廊', exact: true })
at main (tests/gallery/browser.cjs:157:80)
页面 alert: 图片格式不受支持，或资源引用不一致。 当前项目未更改。
```

先保留上述错误、Node `v24.22.0` / Playwright `1.64.1` / Chromium `156.0.8078.4`，再只读检查 fixture。独立 CRC32 计算确认原 68-byte PNG 的 IHDR/IEND CRC 正确，但 IDAT `storedCRC=efa3bd79`、`actualCRC=efa2a75b`；独立 zlib 解码得到 `[1,255,255]`，像素流正常。联网检索服务返回空错误，直接读取 W3C PNG 官方规范 <https://www.w3.org/TR/PNG-Structure.html#CRC-algorithm> 成功，核对 CRC 覆盖 chunk type 与数据、不覆盖 length。总负责 Agent 授权后只替换 PNG 的 IDAT CRC，保持 68 bytes / 1×1 像素与所有断言；未放宽产品解码校验。修复后重新执行 gallery browser，desktop/mobile 均通过、外网 0、页面错误 0。

总负责 Agent 进一步只读核查并修正 `tests/project-package/format.test.cjs` 的同像素 fixture（原 IDAT `storedCRC=efa34599`、`actualCRC=efa2a75b`），随后确认 `npm run test:project-package` 35/35 通过；此修正由总负责 Agent 执行，没有产品代码变化。

## 接口与剩余风险

QA 没有增加或修改生产接口。测试依赖 PLAN 冻结的 `createProjectPackage`、`parseProjectPackage`、`parseProjectFile`、`encodePackageZip`、`decodePackageZip`，以及原 JSON 按钮和保留的 file input class。新增 fixture 导出只用于测试。

- 真正空存储恢复已在 Chromium 验证；未覆盖 Firefox/Safari、其他操作系统或浏览器原生下载交互差异。
- 浏览器图片入口检查实际可解码性；破坏 IDAT 后重算所有包级校验的资源也会拒绝。Node 无浏览器原生解码 API 时仍执行签名、大小、引用、CRC/SHA256 层。解码检查不代表杀毒、来源真实性或对未知浏览器解码器漏洞的防护。
- 恢复运行指在既有可信 BlockCraft 壳中导入项目包并运行声明式内置积木，不代表项目 ZIP 自带新的应用程序运行环境。原 React 源码 ZIP 独立回归通过。
- 浏览器完整往返使用内置 gallery/form/list/metric/timer；精确自定义组件版本由格式 Agent 的单测与原 JSON/源码 ZIP 回归覆盖。
