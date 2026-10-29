# Image-Workshop bounded ACK — 2026-10-29

已通过连接的 GitHub 工具实际读回 [T3 提案评论](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6496938470)，核对了评论前部的实施范围与随后附录审计。结论：**ACK — 仅同意新增离线 preflight 模块的接口准备范围**。

认可的新入口合同：静态8-bit非交错PNG，仅IHDR/连续IDAT/IEND，单边<=1024、像素<=1,048,576、PNG<=524288 bytes、inflate输出<=4,195,328 bytes；不支持的供应商输出拒绝，不转称MOCK，不自动重生。附录4096/16M是旧HTTP合同审计值，不是本次新preflight实际准入上限。约4MiB inflate上限不等于进程RSS上限；不声称通用归一化或跨格式安全解码。

认可下载准备边界：默认空精确HTTPS主机allowlist、仅公共IPv4、固定DNS解析地址并验证TLS主机、禁止重定向和压缩响应、有界流读取/deadline、连接实际close前保留并发槽。仅靠域名allowlist不足，应以独立QA确认实现满足这些约束；本ACK未独立测试新模块，因此不证明其实现已安全通过。

确认文件所有权：Supervisor/Image-Backend仅实现新增 `server/image-generation/preflight/**`、`tests/image-preflight/**`；现有 `image-generation/1`、ProjectAsset、前端http/controller/panel、IndexedDB、JSON/ZIP保持冻结。未来前端REAL接口owner为Image-Workshop；未来资源格式owner为Supervisor单一实现负责人；均为未来任务，不能把责任指派解释成具体共享schema已获准实施。

尚未ACK的接口：REAL wire discriminator/费用终态、可信server project映射、幂等键恢复、durable image job/budget账本、可携带生成来源metadata版本与迁移。完整prompt/source/provider/model/时间/hash不应塞入name/altText；新旧格式兼容策略及独立迁移测试需具体RFC。本次不解除这些BLOCKED项。

本ACK来自本次新分派的独立Workshop审查角色，不冒称 #96/#98 原作者确认，不构成付费API、供应商选型、secret、budget、merge、deployment或共享schema修改授权。真实图片生成和完整端到端仍 `REAL_PROVIDER=NOT_RUN`。

[REPORT]
role: Image-Workshop
base_sha: 77b8aadb3fe9dfb1e4ff4c1c50fa5a12bf02dbad
head_sha: NONE
pr: NONE
status: PARTIAL
completed: 实际读回T3评论6496938470；对新增离线preflight准备范围给出bounded ACK；共享契约冻结和唯一owner已核对。
tests: OFFLINE documentation/source-contract review only；新HEAD代码/运行验收未执行；REAL_PROVIDER=NOT_RUN。
blockers: 完整REAL协议与portable provenance RFC未ACK；供应商/预算/可信身份/持久账本/密钥和真实验收仍待各自条件。
next: Supervisor记录本ACK并等待独立QA新精确HEAD结论，后续另行提交REAL/资源版本RFC。
approval_needed: NONE
