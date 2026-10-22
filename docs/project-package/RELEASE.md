# 项目包 v1 发布整合

用户在验收阶段之后授权“确认无误后，合并进主干并部署到魔塔”。发布沿用现有私有测试空间，不启用额外 AI、修改预算、扩容或更换链接。

## 历史与契约

远端主干为366133c；本地资源底座a77cf25与它的共同祖先为91bf7c7。资源底座此前没有进入远端主干。本次真实三方整合将gallery资源协议、ZIP包与Mochi主动建议同时纳入，未通过覆盖主干移除新功能。

package.json保留双方测试脚本；Mochi计划服务保留主干form/list展示、克隆、reservedIds、能力声明、无变化拒绝及TrustedPlanGuard，gallery仅投影资源元数据，不上传图片字节或接受资源写命令。gallery ID的最终全局冲突仍由Host校验。

ZIP格式、版本/迁移、CRC32/SHA256、路径及大小门禁、浏览器原生图片解码、凭据检查见FORMAT.md。示例ZIP可在干净环境导入并运行，继续使用ProjectAsset/dataUrl契约。

## 整合验证

- `npm run build`通过。
- `npm --prefix server run build && node server/custom-block/build-protocol.mjs`通过。
- `node --test tests/field-plans/*.test.* tests/gallery/server.test.mjs tests/mochi-proactive/*.test.* src/integrations/mochi/planning.test.cjs`：176/176通过。
- `node tests/project-package/browser.cjs`：通过；桌面导出、干净390px上下文导入、图片解码预览、精确再导出、计时器/表单运行、失败不替换不增加备份、旧v1迁移全部通过；外网请求0、AI调用0、页面错误0。
- 全量离线回归89文件1410/1410通过，六套浏览器全部通过；精确命令、初始失败与修复证据见integration-tests.json。

## 发布边界

现有部署checkout基线为414ff4cca41e6716c7ef7c78bc51707c1c8f0b7c；保留Studio会话、幂等、持久账本、安全网关及免费CPU配置。部署专用resolveRequest组合不由主干版本覆盖。认证通过已有中继，不读取凭据。

保护文件：server/paid-gateway/ledger.mjs、provider.mjs、pricing.mjs、server/studio-launcher.mjs、server/studio-deployment.mjs、Dockerfile、ms_deploy.json。部署前核对其SHA256逐字节不变。

合并与平台构建完成后的实际提交号、平台状态和线上验证记录在工作区发布报告，避免只为追加部署记录再次触发部署。浏览器覆盖以Chromium桌面/移动视口为主；STORE格式限制、保守凭据扫描及哈希非身份认证的限制继续适用。
