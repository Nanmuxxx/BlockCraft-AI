# Safe Viewer 接口契约（实验）

2026-10-19；适用于 `phase2/safe-tsx-viewer` 的独立实验模块。正式 C 模式接入前必须由 AI Core、Workshop 和安全负责人共同确认。

## 1. Artifact → Viewer

### 请求

`POST /api/safe-viewer/compile`，仅同源宿主可调用。

```json
{
  "protocol": "blockcraft-safe-viewer/1",
  "instance": {
    "id": "fixture-counter",
    "definitionId": "fixture-counter",
    "versionDigest": "sha256:<64 hex>",
    "props": {}
  },
  "artifact": {
    "artifactVersion": 1,
    "manifest": {
      "protocolVersion": 1,
      "definitionId": "fixture-counter",
      "name": "计数器",
      "sdkVersion": "1.0.0",
      "entry": "src/Counter.tsx",
      "propsSchema": {},
      "stateSchema": {},
      "events": {},
      "requestedCapabilities": []
    },
    "sources": {},
    "dependencies": {},
    "build": {}
  }
}
```

服务端保证：

- 重新计算 `computeVersionDigest(artifact)`，必须等于 `instance.versionDigest`。
- `instance.definitionId` 必须匹配 manifest。
- `props` 必须匹配 manifest `propsSchema`。
- `requestedCapabilities` 必须为空，`events` 必须为空。
- 只允许 `react`、`react/jsx-runtime` 和制品内相对源文件。
- 不在宿主执行源码；编译在受限 worker 中完成。

### 成功响应

```json
{
  "sessionId": "<random>",
  "nonce": "<random>",
  "runnerUrl": "https://viewer.example/runner?session=...",
  "bundleUrl": "https://viewer.example/runner/bundle/<sha256>.js?session=...",
  "bundleDigest": "sha256:<64 hex>",
  "expiresAt": 1760000000000,
  "cache": "build"
}
```

`runnerUrl` 和 `bundleUrl` 必须属于服务端配置的 Viewer 源站池；宿主 controller 会校验 origin、路径、digest 和 session。

### 错误码

| code | HTTP | 含义 |
| --- | ---: | --- |
| `VIEWER_DISABLED` | 503 | kill switch 关闭 |
| `INVALID_REQUEST` | 400 | 结构/字段/UTF-8/JSON 不合法 |
| `ORIGIN_REJECTED` | 403 | Origin/Host 不匹配 |
| `CONTENT_TYPE_REJECTED` | 415 | 非 application/json |
| `REQUEST_TOO_LARGE` | 413 | 请求体超限 |
| `INVALID_PROTOCOL` | 422 | 协议版本不匹配 |
| `DIGEST_MISMATCH` | 422 | 内容摘要不匹配 |
| `IMPORT_REJECTED` | 422 | 非白名单导入/动态导入/执行原语 |
| `SOURCE_CAPABILITY_REJECTED` | 422 | 源级危险能力 denylist |
| `BUNDLE_LIMIT` | 422 | bundle 超限 |
| `COMPILE_TIMEOUT` | 504 | 编译超时 |
| `COMPILER_BUSY` | 429 | 编译并发已满 |
| `RUNNER_CAPACITY` | 503 | 没有健康 Viewer 源站 |
| `SESSION_EXPIRED` | 404 | session 不存在/过期/不匹配 |

## 2. 消息协议

### boot

runner → parent，目标 `parentOrigin`：

```json
{ "protocol": "blockcraft-safe-viewer/1", "type": "boot", "sessionId": "...", "nonce": "..." }
```

宿主校验 `event.source`、`event.origin === 'null'`、精确字段、session、nonce 和大小。

### init

parent → runner，携带一次性 MessageChannel 端口：

```json
{ "protocol": "blockcraft-safe-viewer/1", "type": "init", "sessionId": "...", "nonce": "...", "props": {} }
```

由于 sandbox 是不透明源，init 的 `targetOrigin` 为 `*`；init 不包含凭据、cookie、宿主句柄或业务写能力，且必须先通过 boot 的 nonce 校验。

### ready / error

runner → parent，经由 MessageChannel：

```json
{ "protocol": "blockcraft-safe-viewer/1", "type": "ready", "sessionId": "...", "nonce": "...", "seq": 1, "sdkVersion": "1.0.0" }
```

```json
{ "protocol": "blockcraft-safe-viewer/1", "type": "error", "sessionId": "...", "nonce": "...", "seq": 2, "code": "RENDER_ERROR", "message": "<bounded>" }
```

宿主校验端口、session、nonce、seq 连续性、精确字段和错误码格式。`ready` 只接受一次。

### dispose

parent → runner：`{ protocol, type: "dispose", sessionId, nonce }`。随后宿主移除 iframe、关闭端口并删除监听器。

## 3. Viewer UI 状态接口

`viewerUiState(status, errorCode?)` 返回：

```ts
type SafeViewerStatus =
  | 'unavailable'
  | 'disabled'
  | 'compiling'
  | 'booting'
  | 'ready'
  | 'error'
  | 'disposed'
```

| 状态 | 含义 | 可重试 | 可卸载 | 可交互 |
| --- | --- | --- | --- | --- |
| `unavailable` | 没有可运行制品 | 否 | 否 | 否 |
| `disabled` | kill switch 关闭 | 否 | 否 | 否 |
| `compiling` | 编译/准入中 | 否 | 是 | 否 |
| `booting` | 等待 iframe 安全握手 | 否 | 是 | 否 |
| `ready` | 隔离环境已提交渲染 | 否 | 是 | 是 |
| `error` | 编译/握手/运行失败 | 是 | 否 | 否 |
| `disposed` | iframe/端口/监听已清理 | 是 | 否 | 否 |

Workshop 接入约束：

- 只有 `ready` 才能显示“运行中”，不能把 `compiling/booting` 文案改成可运行。
- `errorCode` 必须保留并展示；不能自动重试死循环或编译失败。
- 切换选中 block、切换项目、卸载页面时必须同步 `dispose()`；不能保留旧 iframe 或旧 controller。
- `mount()` 可重复用于同一 controller；每次挂载必须拿到新的 session/runner。
- `RUNTIME_TIMEOUT` 会触发 retire；后续挂载必须等待 retire 完成（controller 已串行化）。

## 4. 所有权边界

- AI Core 只提供已准入的 `SourceArtifact` 和实例 props；不提供运行 owner、授权句柄、宿主 cookie 或业务写能力。
- Viewer 只返回运行状态/错误；不直接写项目、记录、layout、history 或 auth store。
- Workshop 负责 UI 状态呈现和生命周期；不得把 Viewer iframe 嵌进可写宿主表单或把宿主 token 放进 props。
- 安全运行负责人保留 kill switch；正式接入前默认 `enabled=false`。

## 5. 接入闸门

1. 独立安全验收通过（本分支测试 + 目标浏览器 + 部署源站池）。
2. AI Core 确认 Artifact 精确版本、props schema 和生命周期。
3. Workshop 确认状态机、错误文案和 dispose 时机。
4. 生产 CSP、Viewer 源站/证书、源站 quarantine 和容量告警完成。
5. 只有在上述条件满足后，才允许把实验 controller 接到正式 C 模式；否则保持 `unavailable`。
