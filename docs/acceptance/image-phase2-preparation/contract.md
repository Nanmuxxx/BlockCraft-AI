# Phase 2 T1/T3：Image-Workshop 独立只读审计与资源契约提案

查询日期：2026-10-29 Asia/Shanghai。审计 worktree：`BlockCraft-AI-image-http-phase2`；`git rev-parse HEAD` 为 `77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad`，`git status --short` 为空。本报告是本次实际分派的独立 Workshop 角色审查，不代表原 PR 作者确认。没有修改共享源码，没有真实供应商调用。

## 结论与阻塞

现有 PNG 资源、显式采用、本机事务保存、B/C 同源状态与 JSON/ZIP 可复用；**现有 HTTP 接口不能承载真实生成**。`kind: HTTP_MOCK/MOCK`、`charge: NONE|UNCERTAIN`、Mock UI 文案和没有 provenance 的 ProjectAsset 都是明确的契约边界。不得将真实图像伪装为 MOCK，或把服务端日志当成可携带的项目元数据。

静态 PNG 的新服务端下载/验证模块可以独立开发测试，不改变共享文件。真实端到端接线需新的版本化协议及资源元数据方案先在 #92 提案、确认唯一文件负责人和接口 ACK。

## T1：精确源码证据

下列链接全部固定至本次 SHA；行号指该实现，不借用旧 PR 测试结果证明本轮运行。

| 领域 | 当前实现与证据 | 缺口/限定 |
|---|---|---|
| ProjectAsset | [appSpec.ts L31](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/model/appSpec.ts#L31)：id/name/altText?/mimeType/dataUrl；assets 在 ProjectState 中可缺省 | 没有 prompt、provider/model、createdAt、job ID、content hash、generation source。不能擅加字段。 |
| 严格资源与引用校验 | [appSpecValidation.ts L3](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/model/appSpecValidation.ts#L3)、L29–71：最多32张、每张524288 bytes、总1048576 bytes；仅PNG/JPEG/WebP/GIF data URL；签名、MIME匹配；未知字段拒绝，name<=160 UTF-16 units，altText<=240 | 基础层只有签名，非全面解码；无通用宽高/像素上限。新的生成入口应更严格，但不得声称历史导入具有同样强度。 |
| imageIds / 引用一致 | [appCommands.ts L81](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/model/appCommands.ts#L81)：同一批次 addProjectAsset/configureGallery；重复资源ID拒绝，被引用资源不可删除；validation L95–98 确保imageIds唯一 | 这不是按图片内容去重；每次生成随机资源ID。 |
| 预览生命周期 | [controller.ts L108](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/gallery-generation/controller.ts#L108)：生成前获取快照/权限，预构造commands但不发布；PNG验证后冻结candidate，确认才workspace.adopt；取消/卸载abort | 候选只在内存；刷新不恢复候选图片。digest是workspace/target/prepared全项目摘要，不是图片字节内容键。 |
| PNG解码 | [controller.ts L32](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/gallery-generation/controller.ts#L32)：字节结构/CRC/IHDR/IDAT/IEND、拒APNG，像素<=16777216，浏览器实际解码尺寸一致、释放bitmap | 本地候选无单边4096检查；createImageBitmap abort只结束等待，不保证立即中止native解码；16M RGBA约64MiB且不含其他副本。 |
| 服务端PNG子集 | [validation.mjs L5](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/validation.mjs#L5)：只接受MOCK、PNG、8bit、非交错灰度/RGB/灰度alpha/RGBA、仅IHDR/IDAT/IEND；CRC与有界inflate、实际宽高一致 | 色板、元数据、交错PNG也被拒绝；供应商输出未必符合。该函数不能被改kind调用冒充真实验证。 |
| B/C共享状态 | [customProjectSession.ts L30](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/model/customProjectSession.ts#L30)、[appRuntime.ts L87](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/model/appRuntime.ts#L87)：单一owner及read projection；[AppSpecWorkshop.ts L139](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/components/app-builder/AppSpecWorkshop.tsx#L139) 让B编辑和C renderer共用runtime；[AppRenderer.tsx L88](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/components/app-renderer/AppRenderer.tsx#L88)按imageIds读取assets | 不应新增第二套React资源仓库。B以积木/面板呈现，C以图库图片呈现，不声称两个画布完全相同UI。 |
| 持久化/失败 | [session.ts L36](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-workspace/session.ts#L36)：先JSON/ZIP/解码校验，持久化lease后保存，成功才publish；保存结果不明或已存未发布进入recovery；[repository.ts L48](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-workspace/repository.ts#L48)：strict IDB事务写head+receipt、expectedSequence CAS、最多128 receipt | 本机事务不是服务端预算账本。重复确认收据与图片内容去重不同；结果不明不得重试采用。 |
| 数据库与旧项目 | [database.ts L5](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-json/database.ts#L5)：IDB版本2、保留projects并增加current-workspace；[file.ts L17](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-package/file.ts#L17)按内容解析，接受明确旧v1/v2形状并迁移 | 升级新元数据必须另外测试旧DB及旧JSON；不能猜兼容。 |
| JSON往返 | [project-json/format.ts L27](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-json/format.ts#L27)：JSON envelope version1、完整结构校验、精确artifact引用、4,000,000字节限制；asset data URL与name/altText保留 | 当前没有生成metadata可往返；JSON文本空白不必一致，比较解析后元数据与解码字节。 |
| ZIP往返 | [project-package/format.ts L116](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-package/format.ts#L116)、L157：包version1，资源独立文件，长度/SHA256/严格路径/引用/metadata一致，native decode，再重建canonical base64；[zip.ts L3](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-package/zip.ts#L3)：34文件、单文件4MB、总5.1MB、ZIP5.2MB | 项目包与源码导出工具的ZIP限制不同，不能混称。未准许侧载任意provenance sidecar。 |
| 通用导入解码 | [image.ts L13](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/project-package/image.ts#L13)：createImageBitmap缩至1x1后释放；fallback Image；非浏览器只保留签名/hash | 缩小输出不等于解码内存硬上限；没有显式deadline/预解码像素阈值。属于后续独立入口加固，不应假称已解决。 |
| 跨标签与旧回调 | [http.ts L24](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/gallery-generation/http.ts#L24)：Web Locks串行临界区、持久opaque request/job ID，owned compare后才写/清；deadline120s、每请求10s、response710000 bytes；取消回调不能清锁；reconcile仅匹配授权GET且明确终态NONE清理 | localStorage锁不是账本、不是跨设备身份。未取得job ID的未知请求需人工核对；REAL应新增按幂等键恢复接口，不能再次POST新key。 |
| MOCK/REAL隔离 | [contract.ts L1](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/server/image-generation/contract.ts#L1)、[GalleryImagePanel.tsx L9](https://github.com/Nanmuxxx/BlockCraft-AI/blob/77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad/src/integrations/gallery-generation/GalleryImagePanel.tsx#L9) DEV-only HTTP选项、fixture-project硬编码；controller L122 所有非Canvas标为Mock | 不支持REAL来源或已结算费用，不能改环境变量即可启用。 |

## T3：待发布/ACK的资源合同

**准备阶段（本轮可实现）**：新增独立、无默认网络派发的服务端纯模块和离线测试；不改appSpec、现有contract.ts、前端http/controller、IDB、JSON/ZIP。所有输入不可信，校验失败即拒绝，不默默提高配额。

- 项目生成资源只接收静态 `image/png`，实际PNG字节与MIME、宽高必须一致，canonical base64；<=524288 bytes。保留现有最多32张/总1048576 bytes限制。
- 最小兼容产物采用8-bit非交错PNG，IHDR+连续IDAT+IEND，禁止APNG和多帧。供应商JPEG/WebP/带metadata PNG若不能安全归一化，不可直接采用；生产级归一化需独立有界解码器/进程与测试，不能仅删除MIME标签。
- 兼容上界仍可声明单边<=4096、总像素<=16777216（现有HTTP合同）；首个真实测试建议固定1024x1024，单张RGBA4MiB。验证raw scanline长度 `(channels*width+1)*height`，RGBA最高67,112,960 bytes。**这只是inflate输出上限，不是总进程RSS保证**；应另设独立进程内存/CPU/总时限与并发上限，超限拒绝。更紧的真实产品上界要独立REAL协议声明，不追溯改变旧资源。
- 下载接口不得让浏览器提交任意URL。服务端从可信供应商响应抽取，并使用精确HTTPS主机allowlist、禁止userinfo/自定义端口/IP字面量/内网与特殊IP，DNS解析后固定连接地址并保留TLS主机验证；禁止redirect（或每跳重新同等验证），流式累积上限+读取deadline，不信Content-Length。URL与签名查询串不得出现在日志或资源元数据。仅域名allowlist不能防DNS rebinding。
- 候选包含经过验证的不可变字节/尺寸/hash、目标gallery、项目revision、可信任务归属和来源。未采用候选不能进入assets、IDB保存或导出；预览丢弃不退款、不解除费用未知。候选有效期与远端费用记录保留必须分开。
- 采用仍沿用同一owner、commands、IDB CAS+receipt事务。字节去重建议按 `SHA256(normalized PNG bytes)` 检索同项目已有资源，命中时复用asset ID并避免重复imageIds；必须定义元数据冲突策略，不能把不同提示词生成事件悄悄覆盖到旧资源。禁止跨用户哈希存在性泄露。
- `name` 与 `altText` 只用于名称和可访问性，后续应标注“AI生成”且alt描述图像，不把500字prompt截断塞入alt冒充完整记录。短期无共享schema变更时，只有既有name/alt等元数据能够保留。

**元数据的必要后续方案（尚未批准、尚未实现）**：完整prompt/source/provider/model/生成时间/规范化版本/content hash 属于用户要求的可携带资料，而现有asset拒绝这些字段。需要单独版本RFC：给新格式的asset加结构化provenance；新reader接受旧版缺省provenance但绝不伪造历史来源；新JSON/ZIP顶层新版本使旧reader明确拒绝新功能，避免静默丢字段。旧格式仍可原样读取；若提供兼容导出，必须由用户明确选择并提示会丢生成来源，不能称无损。AppSpec中的业务gallery/imageIds本身无需升级。实际版本号必须由现有各格式owner确认，不能此处直接定案。

元数据RFC必须先明确prompt隐私与导出提示、source枚举、可空/缺省规则、字段长度、Unicode规范、provider/model固定值或白名单、时间语义、批量重复事件表示，以及是否导出opaque任务ID。费用账本不进入项目包；仅生成摘要也不能冒充完整prompt。服务端审计可存最小事件/摘要，未经隐私设计不得保存敏感图片或整段prompt日志。

## 所需ACK与文件所有权

1. **Image-Backend** 独占新服务端下载/校验/离线adapter模块；Mock既有函数不变。确认normalized bytes/size/hash接口，安全错误、cancel=不保证停止计费、unknown费用永久阻止新派发直到对账。
2. **Image-Workshop** 独占未来前端REAL adapter/controller/panel改动；必须先确认版本化HTTP discriminants、可信server project映射、幂等key恢复、费用终态语义和preview/adopt元数据。现有MOCK合同拒收REAL是正确行为。
3. **资源格式owner（须Supervisor指派唯一人）** 独占appSpec/validation、custom project验证、JSON/ZIP、IDB升级；在元数据RFC与迁移测试通过前冻结这些共享文件。若暂不升级，完整元数据闭环状态必须BLOCKED，不能宣称完成。
4. **QA** 在新精确HEAD隔离检出；每类结果分OFFLINE/MOCK/REAL。不接受仅编译通过或复用此前截图。

## 验收矩阵与回滚

必须新测：伪MIME/非canonical base64/CRC和IDAT损坏/尺寸欺骗/APNG/尾随数据/压缩炸弹/下载超限和重定向/HTTP停滞/DNS特殊地址；合法512KiB边界与超1字节；真实不同来源误送旧协议必须拒绝；完整metadata Unicode/边界及新旧版本；重复确认与相同字节去重；取消/刷新/卸载/跨tab旧回调；未知费用保留；quota/事务abort/已存未publish/recovery；B/C同asset与字节；保存刷新；JSON与ZIP导入空context后比较图像SHA及完整metadata；desktop/390px；生产路由仍关闭。

准备模块回滚：删除新增离线模块与测试即可，不触及用户数据。将来格式升级回滚不能删除provenance或降版本覆盖已有项目；旧reader明确拒绝新文件，保留原文件备份，提供经过验证的新reader恢复路径。远端任务取消/删除不得抹掉未知费用ledger。

## 本次命令与排障记录

只读：`git rev-parse HEAD`、`git status --short`、`rg --files src`、`rg -n ...`、`nl -ba ...`；完整工作区未修改。本次没有运行浏览器/单元验收，tests=NOT_RUN，源码审计不等于运行验证。

两次路径猜测错误完整诊断：`rg: src/integrations/project-persistence: No such file or directory (os error 2)`、`rg: src/components/blocks/GalleryBlock.tsx: No such file or directory (os error 2)`，包含这些路径的搜索命令退出2（前一个命令后续管道掩盖了聚合退出码，不能据此认定全成功）。工具 `ripgrep 15.2.0 (rev e89fff89ac)`，Darwin。只读 `rg --files src` 确认实际位置是project-workspace和components/app-renderer/AppRenderer.tsx。检索维护者[路径不存在问题记录](https://github.com/BurntSushi/ripgrep/discussions/1998)，未将其他平台或配置错误套用本案；修正搜索路径后exit0。没有安装工具、读取凭据或改源码。

[REPORT]
role: Image-Workshop
base_sha: 77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad
head_sha: NONE
pr: NONE
status: PARTIAL
completed: 精确HEAD前端/资源/持久化只读审计；T3兼容PNG与元数据版本化提案；未改共享源码。
tests: OFFLINE只读源码核对；运行验收NOT_RUN；REAL_PROVIDER=NOT_RUN。
blockers: REAL协议、可信project映射、portable provenance版本方案尚未ACK；真实身份/账本与供应商配置另由Backend/Cost负责。
next: Supervisor将本提案发布#92并明确独占owner，Image-Workshop随后核对实际发布方案给出范围限定ACK。
approval_needed: NONE
