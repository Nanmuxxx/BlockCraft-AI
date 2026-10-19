# 独立复现（合成数据，无真实密钥）

这些脚本是审计探针，不是部署或付费开关。请从对应精确候选的隔离checkout根目录运行，使用已安装的Node24依赖；不得在生产实例或真实账本目录运行。

- HTTP canary与Vite脚本对应Core SHA `63a4ab2b65b9ffba72875a383a4ad82f472725fe`。先执行 `npm --prefix server run build`；HTTP脚本使用cwd/server模块，不是其文件所在PR的模块。Node命令以 `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test /usr/local/bin/node /absolute/path/to/http-canary.mjs` 运行。Vite探针以Python3运行 `vite-build-canary.py`，需本环境/usr/local/bin/npm；其他平台明确调整二进制路径并记录环境。
- 多句柄探针对应Gateway旧SHA `c1c7df0c68e9c7ecc337ffd296ed5a3042615e4b`；在该隔离checkout根目录运行 `env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /absolute/path/to/duplicate-sidecar.mjs`。它输出观察结果，不将旧bug作为预期PASS；修复后要求第二次reserve抛错、ledger_entries=1。只有临时mkdtemp目录被删除。
- HTTP脚本自己设置loopback-only fetch守卫，注入合成key/Mock，输出 `supervisor-canary-result.json`；Vite脚本显式构造不含继承环境的env，输出 `supervisor-build-canary-result.json`。没有脚本打印process.env、读取.env或调用真实DeepSeek。
- 所有SHA字段是本轮实际checkout的记录常量，复测新SHA时必须人工绑定正确候选并改记录，不能复制结果当作新SHA通过。
- 它们只证明报告中的范围；不要将HTTP/Vite canary扫描解释为容器镜像/Studio/浏览器/ZIP或真实secret安全验收。
