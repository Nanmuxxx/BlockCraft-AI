# 浏览器回归排障记录

环境：macOS，Node v24.22.0，Vite 8.3.4，Playwright 1.62.1，Chromium 151.0.7922.34。所有模型交互均离线 fixture；无真实 AI 调用。

初轮并行执行 `node tests/{mochi,field-plans,project-json,layout-order,workshop-presentation}/browser.cjs`；各脚本实际命令和完整输出保留在同目录对应 `.log`。结果：project-json 退出0，其余退出1。

## Vite 504

workshop-presentation/report.json 保留完整错误：`Failed to load resource: the server responded with a status of 504 (Outdated Optimize Dep)`，3次；failure.png 空白。field-plans 在等待 window.fieldQA.runtime 40秒后失败，layout-order 等待报名积木5秒后失败，均无应用页面错误。只读检查确认三个 runner 均未设置独立 cacheDir，使用同一 node_modules（工作区中为依赖目录链接）和默认缓存。

来源：
- https://vite.dev/config/shared-options.html#cachedir ：官方文档确认默认缓存为 node_modules/.vite，内容包括预构建依赖。
- https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/middlewares/transform.ts ：官方代码将 ERR_OUTDATED_OPTIMIZED_DEP 映射到504 / Outdated Optimize Dep，并说明预构建依赖变化使旧请求过期。
- https://github.com/angular/angular-cli/issues/31700 ：维护者仓库中有相同双 dev server 共享 Vite 缓存的公开问题；用于支持推断，非此项目已确认根因。

已确认：504来自Vite过期预构建依赖。高置信推断：本轮并行server共享缓存发生失效；最小修复为保留首轮证据后顺序执行，不改产品、不删除缓存。最终验证见 summary.json。

## Mochi 旧回归断言

原测试期待“AI 修改能力尚未启用：DeepSeek”，而当前 AppSpecWorkshop 已按字段计划服务状态给出具体提示。首次改为不可用文案后，报告显示 Host 与建议面板各有一个相同状态文本，引发 Playwright strict mode violation；定位已限定 .mochi-ai。继续检查发现旧 runner 未 fixture 新的 /api/mochi-plan/status，主动 abort 引发浏览器 console.error；现为状态端点提供 enabled:false 的离线HTTP响应，断言当前“字段计划服务尚未启用”提示。仅更新测试，不改产品。

完整失败保留：mochi.log、mochi-sequential.log、mochi-sequential-final.log。

## presentation 字体403

顺序复跑时全部四组业务case已通过，但console.error有4条403；完整命令/错误/退出1保留在 workshop-presentation-sequential.log 和同名目录 report.json。终端明确说明软链接依赖下 @fontsource/pixelify-sans 文件超出 Vite serving allow list；require.resolve只读检查证实字体位于工作区之外的依赖目录。

官方来源：https://vite.dev/config/server-options.html#server-fs-allow （strict默认true，allow外文件返回403）。最小修复仅在测试的 createServer fs.allow 中增加 require.resolve 得到的字体包目录，同时保留root；不改产品vite配置，不关闭strict。

联网搜索曾遇到工具 HTTP transport 错误（无内容），随后用 Python 3.14 urllib 只读读取官方页面退出1：`ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1082)`，包装为 urllib.error.URLError；命令为 urllib.request.urlopen('https://vite.dev/config/server-options.html', timeout=20)。未关闭证书验证、未修改环境。回到官方联网工具后成功读取文档，证书问题不影响测试且未进一步操作。
