# BlockCraft AI 第一阶段验收记录

日期：2026-10-22

本阶段交付一个可扩展的声明式资源与积木垂直切片：`gallery` 积木贯通 AppSpec、B/C 模式、Mochi 计划、项目 JSON round trip 和 React/Vite ZIP 导出。范围不包含图像生成、动画积木、作品发布平台或线上部署。

## 验收结果

- `npm test`：224/224
- `npm --prefix server test`：37/37
- `npm run test:generation`：35/35
- `npm run test:mochi-host`：63/63
- `node --test tests/gallery/server.test.mjs`：14/14
- `node --test tests/project-zip-export/export.test.mjs`：67/67
- `npm run test:workshop-export`：9/9
- `npm run test:field-plans`：110/110，其中 paid-gateway 21/21
- `npm run build`：通过
- `git diff --check`：通过

浏览器验收证据见 [`browser-report.json`](./browser-report.json)：Chromium 151.0.7922.34，桌面 1280x920 与移动 390x844 均通过；每端完成 B/C 切换、资源校验、画廊预览、Mochi 配置/新增/删除、JSON 导入导出和 ZIP 导出；`externalRequests=[]`、`pageErrors=[]`。

独立 ZIP fixture 使用 512 KiB 图片：实际导出 20 个文件、741033 字节；解压到临时 React/Vite 工程后执行 `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm run build` 成功。

## 安全与边界

- 资源最多 32 个，单张解码后最多 512 KiB，总量最多 1 MiB；拒绝 SVG、远程 URL、无效 data URL 和签名不匹配。
- Mochi 只接收资源元数据，不接收 data URL/字节；变更经过预览、明确确认和 CAS 提交。
- JSON 仅在精确的资源 data URL 路径放宽大型字符串限制，普通超长字符串、原型污染和访问器约束保留。
- 本阶段未读取密钥、未执行真实 AI 请求、未修改魔塔链接或部署配置、未执行 push。

## 后续限制

图像生成、动画/视频媒体积木、全面的主动建议，以及账号、保存、发布、分享、权限、版本和运行隔离仍需后续阶段建设。
