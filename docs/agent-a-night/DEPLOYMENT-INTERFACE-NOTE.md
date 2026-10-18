# Agent A / PR35 运行依赖交接建议

2026-10-19 04:08；本文件仅为接口契约与补丁建议，没有修改Dockerfile、.dockerignore、工作流或部署。REAL_MODEL_CALLS=0。

## 已核对事实

- GitHub main仍为4044fb185a2720eead0dc6710b0d38a215439b98。PR35仍open、未合并，head=f6e7b9cba54a4aae575fbf26de91dc00c4b2c7c0；它的Docker验收针对自己的分支，不包含Agent A修改。
- 本地共享main ref仍停在7e94dc9，不能当作远端main；Agent A隔离分支基于上述4044fb1，未改main。
- Agent A新增server/ai-abort.mjs，被index.mjs、trusted-interactive.mjs、mochi-ai/{http,service,provider}.mjs静态导入。CustomBlock离线模块也使用它，但尚未接正式HTTP。
- PR35构建阶段和最终阶段逐文件COPY未包括该文件；其原Dockerfile快照来自Agent C已归档的固定PR35 head。Agent A重新运行Node模块链接检查：原文件清单缺失时ERR_MODULE_NOT_FOUND/退出1，补充单个ai-abort.mjs后模块链接退出0。此检查不启动服务、不调用模型、不构建容器。

## 部署负责人后续补丁建议

1. 在.dockerignore已有server白名单中保留server/ai-abort.mjs。
2. 将server/ai-abort.mjs加入构建阶段server文件COPY。
3. 将/app/server/ai-abort.mjs加入runtime阶段COPY，目标仍为./server/。
4. 基于PR35与Agent A的精确组合重新构建并运行现有容器验收，覆盖模块启动、health、无key生成拒绝、trusted默认拒绝、静态路由与路径隔离。
5. 不因Node链接通过而省略Docker实测；不增加模型调用权限、自动启用修改入口或扩大镜像内源码执行权限。

## 可复现证据

先npm --prefix server run build，再运行：

`node tests/ai-core-night/check.mjs runtime-inventory node tests/ai-core-night/runtime-inventory.mjs`

脚本固定PR35已知最终COPY清单，将本分支可信服务文件复制到临时目录，两次隔离Node import；finally删除临时目录。只构造反事实补齐文件清单，不编辑任何部署配置。原始结果见logs/runtime-inventory-*。这不是PR35当前精确容器构建或部署证据。

需要其他模块配合：PR35部署负责人。Agent A仅交付本说明，未向其他chat或PR发送评论。
