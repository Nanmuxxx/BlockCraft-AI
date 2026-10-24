# 魔塔公网独立验收准备（零付费）

唯一Studio：https://www.modelscope.cn/studios/Nanmuxxx/BlockCraft-AI-Fullstack

当前：NOT DEPLOYED（#57部署交接报告）/ NOT VERIFIED（本轮独立公网应用验收）。应用origin、平台revision、image digest均未取得。管理页面可打开/标题可见不能证明应用部署或公开运行。本轮IAB超时，Windows控制因不能可靠识别URL被策略停止；无独立页面截图，不绕过控制限制。

部署候选按#57 6272094257：main `4a95cae50f772cd242d932cdbd93366381d1df74`，无密钥源包SHA `0aa88413cbe9d5611a963f1b8c7ecc87405b2b5586c9ea92a156c30b96b16812`，147files。该包技术准备条件GO，不等于已批准/已部署；不含Gallery #55和AI组合#68。LittlePig1111旧空间/ed01证据不适用于此目标。

## 收到部署后证据才执行的冒烟表

执行前从Lead取得实际应用origin、平台revision、source SHA、image digest/构建日志、部署时间及无密钥配置声明。对照候选能力白名单，不能用未合并Gallery做现网必达项。浏览器操作以可用且获准的控制机制为前提。

| 检查 | 操作与成功条件 | 本轮结果 |
|---|---|---|
| 公开可见性 | 未登录独立上下文访问指定Studio，记录时间、公开状态、运行/文件界面。不要登录或修改权限。 | NOT VERIFIED |
| 真实应用地址 | 仅从该Studio实际应用入口取得origin；记录跳转链，不猜域名。 | MISSING |
| 健康 | GET `${origin}/api/health`，记录HTTP/body/时间；管理URL不能用作base。 | NOT RUN |
| 首页与静态 | 首页200、JS/CSS加载、无致命控制台错误、学习场景页面可见；截图含地址与时间。 | NOT RUN |
| 核心路由 | 使用首页真实链接进入/ai-create及/app-renderer，直达/刷新不404；按实际链接记录query，不猜fixture参数。 | NOT RUN |
| B工作台 | 通过明确标注的离线入口加载社团/学习样例，选中、Inspector参数、拖动；记录来源为Fixture。 | NOT RUN |
| C预览 | 新增/读取/修改/删除一条合成记录、统计联动、B/C往返；只在无模型离线链路操作。 | NOT RUN |
| 离线Demo | /app-renderer现有社团/学习样例及刷新可用；Gallery不在当前main包内，记N/A而非失败。 | NOT RUN |
| 状态边界 | 只读Mochi状态显示disabled；生产ZIP404为当前候选预期，不标导出故障。 | NOT RUN |
| 零付费 | 不点自然语言“生成”/AI修改、不提交模型POST。匿名401验证应由QA在明确无密钥候选及安全验收授权下完成，交付保障只读取结果，不为验证而冒险触发模型。 | 本轮0调用 |

失败保存实际URL、截图、console/network、复现步骤、HTTP、时间、版本和期望边界，再向Lead报P0/P1。首次部署没有前一可用revision时不能宣称回滚已验证。任何重试部署、权限、密钥、预算仍归授权Owner。

统一记录字段：checked_at(Asia/Shanghai)、studio_url、actual_origin、source_sha、platform_revision、image_digest、build_log_reference、test_case、expected、observed、status、screenshot_path/sha256、network/console日志、model_calls=0、executor、reviewer。未跑写NOT RUN，未取证写NOT VERIFIED，禁止以本地PASS代替公网PASS。
