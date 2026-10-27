# Image-Workshop：固定 Mock 图片闭环

Agent：`codex-image-workshop-20261027`。本聊天由负责人从后端切换到 Workshop；此次 ACK 和测试不是来自另一位独立审查者。后端 #94 保持独立、Draft、未合并；没有继续修改后端。

- base_sha：`bcb6c1a7402ad4b4514feb4865c38d769d7244d1`（重新 fetch 与 ls-remote 确认）。
- 功能与浏览器测试 source SHA：`9b16b249e57e4929a843f49ea9cdc58792606d40`；随后的文档提交不改变功能源码，最终 head 以 PR/#92 为准。
- 分支：`feat/image-workshop-mock-20261027`。
- [接口 ACCEPT / 认领报告](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6445994597)。审核的后端 HEAD：`79080e450ff667eae7c2c8acd700b7b367752f12`；[其 Docker CI](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40526326955) 成功，不等于真实图片模型验收。

## 实际交付

在现有图库面板中选择「固定 Mock 图片（非 AI）」即可使用本地固定的 320×240 PNG（1092 字节）。界面明确说明图片与描述无关，不调用模型、不产生模型费用。原有 Canvas 离线配色模式保持默认。

Mock 字节源只模拟 #94 提出的内部信封形状；`createMockImageAdapter` 校验 `kind:MOCK`、PNG MIME、Uint8Array、尺寸、512 KiB 字节上限及 699100 字符上限，再转为既有浏览器 `ImageProvider` 的 PNG data URL。**没有导入服务端代码，没有调用或伪造 HTTP API，没有付费 fallback。** 测试服务对 /api 的拒绝响应只是阻止模型调用，不是图片后端成功响应。

复用同一个 controller、owner、项目命令、IndexedDB 保存事务、采用收据和 JSON/ZIP 编解码。预览不修改项目；只有显式确认才同时写图片与图库引用。切换生成方式会丢弃候选，保留描述和目标选择；不会删除已采用资源。导出的图片名和 altText 标为 Mock，不声称是按描述生成的 AI 图片。

另外修正非法新输入保留旧候选的问题：空白/超长输入立即清除旧候选，不能误采用上一张。PNG 验证增加 CRC、唯一 IHDR、IDAT、完整 IEND 和静态图片限制；仍执行浏览器原生解码，CRC 正确但压缩数据损坏也拒绝。没有删减容量、解码、授权或持久化校验。

## 文件范围与兼容性

| 文件 | 改动 |
|---|---|
| `src/integrations/gallery-generation/mock.ts` | 本地固定 Mock 字节源与有界浏览器适配器 |
| `src/integrations/gallery-generation/GalleryImagePanel.tsx` | 显式选择、Mock 提示、预览标签及源切换状态 |
| `src/integrations/gallery-generation/controller.ts` | Mock 资产标签、非法输入清候选、严格 PNG 结构/CRC 校验 |
| `tests/gallery-generation/{browser.cjs,browser-cases.js,README.md}` | 复用 M00–M13；Mock 模式增加 W01/W02，支持 390px 主流程 |
| `.github/workflows/offline-gallery.yml` | 新增 Mock 浏览器检查，独立 artifact 子目录 |
| `docs/acceptance/image-workshop-mock/**` | 本报告、命令/退出码、精确 source SHA 与浏览器证据 |

ProjectAsset、AppSpec、图库 imageIds、项目 JSON/ZIP 和 IndexedDB 版本均不改。资源上限仍为单图 512 KiB、总计 1 MiB、最多 32 张；不覆盖用户真实作品。所有浏览器测试使用独立上下文和临时站点，未访问个人 Safari/Chrome 存储。没有编辑 server/**、鉴权/预算实现、生产配置或依赖锁文件。

## 实际测试

环境：Darwin arm64，Node v24.22.0，npm 11.19.1，TypeScript 5.9.3，Playwright 1.62.1，实际 Chromium 151.0.7922.34。桌面 1440px、移动视口 390px；不是实机移动设备或 Safari 验收。独立工具安装命令 `npm install --prefix /tmp/blockcraft-workshop-browser-tools --no-package-lock --ignore-scripts playwright@1.62.1`，退出 0；项目 `npm ci --ignore-scripts --no-audit --no-fund` 退出 0。

| 命令 | 分类 | 退出码 / 结果 |
|---|---|---|
| `node node_modules/typescript/bin/tsc -b` | OFFLINE | 0 |
| `npm run build` | OFFLINE | 0；原有 bundle-size warning 保留 |
| `npm test` | OFFLINE | 0，224 PASS |
| `node tools/project-zip-export/prepare.mjs` | OFFLINE | 0 |
| `node --test tests/project-json/*.test.cjs tests/project-package/*.test.cjs tests/custom-block-bc/*.test.cjs tests/workshop-export/*.test.*` | OFFLINE | 0，117 PASS |
| `GALLERY_TEST_PROVIDER=MOCK ... node tests/gallery-generation/browser.cjs` | MOCK | 0，桌面 M00–M13 + W01/W02 共 16 PASS |
| `GALLERY_TEST_PROVIDER=MOCK GALLERY_VIEWPORT_WIDTH=390 ... node tests/gallery-generation/browser.cjs` | MOCK | 0，移动视口 16 PASS |
| `... node tests/gallery-generation/browser.cjs` | OFFLINE_CANVAS | 0，原有 14 场景 PASS |
| `... node tests/project-package/browser.cjs` | OFFLINE | 0，4 场景 PASS，包含旧 v1 JSON 导入 |

上表 `...` 不是隐藏执行参数：完整 NODE_PATH、输出目录、命令和退出码在 `logs/*.log` / `logs/browser-results.json`，编译/回归的展开 argv 在 `logs/results.json`。类型检查/构建/单测运行于提交前、与功能 SHA 相同的源码；三次图库浏览器报告记录完整 `9b16b249e57e4929a843f49ea9cdc58792606d40`。最终 PR HEAD 的复核与 CI 状态另报 #92，不把文档提交后的 SHA 冒充旧测试 SHA。

桌面/移动 Mock 和原 Canvas 报告均记录外网请求 0、AI 请求 0、pageerror 0。M01–M05 通过实际按钮、下载、上传、刷新验证固定图片预览/丢弃/采用、B/C 同字节、IndexedDB 恢复和空上下文 ZIP 重导逐字节一致。M06–M13 复用已有生产模块+浏览器故障注入，覆盖容量、保存中断/恢复、旧数据库、多页面争写等，不声称全部是点击 UI 测试。W01 含 14 类非法信封/PNG及精确 512 KiB 正常接收；W02 验证非法输入、三次确认只写一份收据、重复提交、取消/超时/释放及旧结果不替换新请求。

已视觉检查桌面与 390px Mock 预览截图，面板没有横向越界；控件宽度也有浏览器断言。原有高画布/侧栏布局未重写。证据文件 `mock-desktop.json`、`mock-mobile.json`、`canvas-regression.json` 来自真实报告；完整截图、JSON、ZIP 和 trace 保留在 `.cache/workshop-mock/`，CI 会生成自己的 artifact。没有声称生成了 MP4。

## 后续依赖与停止边界

ACCEPT 仅针对服务端内部 Mock 接缝。未来 HTTP 仍须后端确认：可序列化成功/错误信封、状态/取消/幂等语义、可信项目授权，以及如何让 120s 长任务与当前 10s 前端期限对齐。此次没有放大超时来掩盖缺失协议，也没有把本机 workspace ID 当服务端权限。

所有本地 Mock 闭环及相关独立兼容性工作已交付；下一项是 Image-Backend 回复最小 HTTP 差异清单并提供受授权 Mock HTTP 协调器，Workshop 才能接入。独立 QA 可同时审查本 PR 的精确 HEAD。REAL 模型、安全/计费及生产放量仍 NOT RUN。approval_needed：NONE（当前工作）；MERGE、DEPLOY、PAID_API 等保持负责人审批。

回退：未合并时关闭 PR；如以后回退，移除 Mock 选择/适配器及此次校验改动即可，无资源或数据库迁移。已采用的 Mock 图片是普通兼容 PNG，仍可由旧格式读取。

排障记录：只读发现命令曾请求不存在的 `tsconfig.app.json`（`cat: No such file or directory`，退出 1）及未匹配的工具目录 glob（zsh `no matches found`）；确认实际配置是 `tsconfig.json` 后使用已存在配置，未改源码绕过错误。Safari 同时被用户切回 ChatGPT，CUA 多次报告 user-changed/超时；未冒称评论已发布，待用户明确提供操作时段后发布了上面的真实 ACK 链接。
