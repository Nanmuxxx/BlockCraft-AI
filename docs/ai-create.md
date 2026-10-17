# AI 生成应用最小闭环

本地启动（不需要改动旧首页）：

```sh
npm --prefix server start
# 另一个终端，在项目根目录：
npm run dev -- --host 127.0.0.1
```

打开 http://127.0.0.1:5173/ai-create（以 Vite 实际显示端口为准）。
点击生成会使用服务端已配置的 DeepSeek，可能产生费用；页面不会自动发请求或自动重试。
前端只向同源 `/api/ai/generate` 发送 `{idea}`，密钥只由后端管理。
Vite 将 `/api` 转发到 `127.0.0.1:3001`，保留 Host 以兼容后端 Origin 校验。
如修改后端端口，请同步修改 Vite 代理目标。生产部署也需要同源 `/api` 反向代理；`vite preview` 不包含开发代理。

返回值必须通过既有 `assertAppSpec`；以空记录、revision 0 和归一化默认位置初始化 ProjectState，
再次检查完整状态后交给既有 AppRuntime/AppRenderer。AI 输出只作为数据，不执行代码。
失败保留已有运行时及记录；成功重新生成才替换应用并清除旧表单草稿。
数据仅存在页面内存；刷新不会恢复。不支持 AppSpec v1 以外的业务能力。

验证：`npm run build`、`npm test`、`npm --prefix server test`。
浏览器 Mock 流程（需本机可用的 Playwright 及 Chromium）：

```sh
node scripts/ai-create.browser.test.cjs
```

该脚本启动独立 Vite 测试进程，拦截所有生成接口请求，返回明确标记的 Mock AppSpec，
测试加载、提交/编辑/删除与统计联动、失败保留、重试、非法 AppSpec、断网和新应用替换。
不会向真实生成后端发送请求，不会调用付费模型。
旧 `/` 学习 Demo 和 `/app-renderer` 示例入口保持独立。
