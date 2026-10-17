# BlockCraft AI 后端（第一阶段）

使用 Node 原生 HTTP/fetch，无新运行时依赖。Node >= 22.16；推荐 Node 24。
仅监听 `127.0.0.1`，本阶段不修改前端或自动连接前端。

## 安装、测试和启动

在项目根目录执行（已有 node_modules 时无需重新安装）：

```sh
npm ci
npm --prefix server test
npm test
npm run build
cp server/.env.example server/.env
chmod 600 server/.env
npm --prefix server start
```

测试全部注入 Mock fetch，不访问网络、无需密钥、不产生 API 费用。
未填写密钥也能启动，health 正常，生成接口返回 `503 AI_NOT_CONFIGURED`。
启动和测试前会用已有 TypeScript 编译器编译原始 `src/model/appSpecValidation.ts`，
产物位于被忽略的 `server/.generated/`。不复制或重写校验规则。
无需在 server 目录单独安装依赖，也不需要新 lockfile。

## 安全配置

只在本机 `server/.env` 中填写 `DEEPSEEK_API_KEY`，或通过服务端进程环境注入。
不要放入前端 `.env`、任何 `VITE_*` 变量、源码、截图或日志。
根目录已有规则忽略所有 `.env`/`.env.*`，仅允许 `.env.example`。

可选 `DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）和 `PORT`（默认 3001）。
服务固定使用 `https://api.deepseek.com/chat/completions`，禁止重定向；不支持客户端指定模型、接口或系统提示。
默认模型按本阶段需求设置，真实账号是否支持该模型未经过付费调用验证。
只有配置真实密钥并主动请求生成接口才会调用付费 API；无自动重试。

这是本机服务，尚无用户认证。不要直接暴露到公网；多人部署前需补充认证、
共享限流和适当的代理配置。当前限流仅在单进程内生效，重启清空，按 socket IP
每分钟 10 次，不信任 `X-Forwarded-For`；最多 4 个读取/生成请求同时进行。
不提供 CORS，浏览器跨来源请求会被拒绝。后续前端接入可使用 Vite 同源 `/api` 代理，
本轮未修改 Vite 配置。

## 接口

`GET /api/health`：`200 {"status":"ok"}`。仅表示 HTTP 服务存活，不验证密钥或上游。

`POST /api/ai/generate`：`Content-Type: application/json`，请求只允许一个 `idea` 字段：

```json
{"idea":"一个带任务清单和完成数量统计的工具"}
```

成功 `200` 直接返回既有 `AppSpec` JSON，无新包装协议。模型必须返回完整 JSON、
`finish_reason=stop`，然后执行原有 `assertAppSpec`；不进行修复、类型强转、默认填充或代码执行。
所有错误为 `{"error":{"code":"...","message":"..."}}`，不返回上游原文或校验细节。

输入最多 4000 个 JavaScript 字符单元，请求体最多 24 KiB（包括分块上传），读取超时 10 秒。
上游整体调用（包括读取响应体）超时 30 秒，响应体最多 128 KiB，生成内容最多 64 KiB，
模型输出 token 上限 8192。客户端断开时取消上游请求。

主要状态码：400 非法输入，403 跨来源，413 过大，415 内容类型错误，429 限流，
502 上游失败/非法 JSON/AppSpec，503 未配置或繁忙，504 上游超时。
日志只含固定启动地址或监听失败消息，无请求体、密钥或上游响应。

无需密钥的手动存活检查：

```sh
curl http://127.0.0.1:3001/api/health
```

生成接口的手动请求会在配置真实密钥后产生真实调用，因此此处不自动执行。
