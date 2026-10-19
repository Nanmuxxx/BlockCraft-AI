# BP 能力声明与验收证据对照｜2026-10-19

本补充文件对应 Issue #57 的 `[DECISION]`（comment `6268988241`）。它只补充能力声明与证据边界，不改变 15 页成品、不修改生产代码、不等待付费研发。

## 版本边界

- BP 技术基线：`8cfa37f5112adaab1e0adbb4cb4086240111d436`。
- 当前 GitHub `main`：`4a95cae50f772cd242d932cdbd93366381d1df74`。
- `8cfa37f → 4a95cae` 的远端比较显示仅新增 Supervisor 协调的 3 个文件，产品代码未变化；因此本轮无需重排 BP 页面。
- 本地产品 checkout 当前仍为旧的 `7e94dc9568501dd4ad218a43b5aca31026aed2b2`，不作为当前 main 证据；BP 成品以远端基线和已记录审计为准。

## 状态标签

- **已验收离线示例**：当前可复现范围，仅为 Fixture/Mock 或固定可信组件。
- **历史真实响应回放**：重放先前记录的模型响应；不是本次实时请求。
- **研发中在线生成**：接口已接但当前在线效果未核验；不能用历史响应或 Mock 代替。
- **产品愿景**：任意 React/TSX 安全执行、Mochi 真实源码修改、公开多用户交付等目标。

## 能力声明对照

| 能力声明 | 可公开写法 | 证据 | 不能扩大为 |
| --- | --- | --- | --- |
| DeepSeek → AppSpec | **研发中在线生成**：入口、JSON/Schema 校验已接；当前可验收展示是离线回放/Fixture | Issue #57 QA 报告 [comment 6269301145](https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6269301145)：2 份历史真实响应回放 + 3 份手工 Fixture，`liveCalls=0`；`FINAL-TECHNICAL-AUDIT.md` | 本轮在线 DeepSeek 成功、模型质量或成功率 |
| AppSpec B/C | **已验收离线示例**：Form/List/Metric 内置积木的 B 编辑、C CRUD 与统计 | QA 报告：双尺寸浏览器回放、CRUD/统计与失败保留；BP 第 6/8 页 | 任意需求、任意 AI 源码或额外业务类型均可运行 |
| 历史真实响应 | **历史真实响应回放**：`todo/club` 与手工 Fixture 单独标注 | Issue #57 QA 报告与 PR #44 历史审计 | 当前请求再次调用真实模型 |
| React/TSX 制品 | 历史番茄钟 TSX 有响应、静态准入、版本绑定；离线安装模块可验 | `CLAIMS-AUDIT.md`；PR #34 / Engine-CAS 记录 | 已编译运行、C 模式安全执行或任意 TSX 可用 |
| Mochi | **已验收离线示例/基础模块**：像素猫、动画、本地建议、聊天 UI/路由与 Engine/CAS；正式 Provider 默认关闭 | PR #49/#52 与 Issue #57 的产品状态说明 | 真实 AI 聊天、授权租约、生产源码改写已经上线 |
| React ZIP | 受支持本机 CRUD ZIP 有独立证据 | `FILE-MANIFEST.md`、`BP-UPDATE-SUMMARY-20261019.md` | 公网多用户导出、任意 TSX 工程导出或 presentation 外观保真已完成 |
| 安全隔离 | **产品愿景/研发阻塞**：任意 AI TSX 隔离 Spike 保持 NO-GO，正式 C 接入禁止 | `FINAL-TECHNICAL-AUDIT.md`、BP 第 7/8/13 页 | 静态校验通过等于编译运行成功 |
| Docker / 公网 | 历史 Docker 基础证据只覆盖构建、健康与拒绝路径；公网 URL/持久预算环境待确认 | Issue #57 Docker 报告（comment `6269294585`） | 魔塔已上线、HTTPS/回滚/付费生产可用 |
| 商业与用户 | 价格、试点、付费意愿和市场判断均为待验证假设 | BP 第 9–12 页 | 用户数量、收入、融资、增长率或付费客户 |

## 成品状态

- 主体 PDF：`BlockCraftAI_Final_BP.pdf`，15 页，813,890 bytes，SHA-256 `29d6aa2a6cdeb489cfa3da48c19851dc3a014df859cdff1f23425cf4323e890c`。
- 可编辑 PPTX：`BlockCraftAI_Final_BP.pptx`，15 页，430,280 bytes，SHA-256 `3ee82646e0a225f6a1f52c50288f26eed8be3708c0fa9fdeae4769bc66574a33`。
- 逐页渲染目录：`rendered-oct19-r3/`；检查记录：`evidence/final-artifact-check-20261019.json`、`RENDER-CHECK.md`。
- 文件所有权仅限 `competition-delivery-20261019/` BP 交付目录；未修改 `BlockCraft-AI` 生产源文件。

## 待办与状态

- `VERIFIED`：15 页成品存在；PPTX/PDF 页数、文字一致性、PDF 字体嵌入、品牌媒体不变和逐页渲染检查。
- `PARTIAL`：BP 能力证据对照已补齐；原生 Microsoft PowerPoint、正式视频播放/听审和 Tech Lead 收片仍待完成。
- `BLOCKED/UNVERIFIED`：在线 DeepSeek 生成、正式 Mochi PlanProvider、任意 TSX 隔离运行、魔塔公开链接、官方提交规则。

此文件不是比赛上传回执，也不是在线产品能力验收。
