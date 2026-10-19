# R03 本地真实 AI 镜头替换记录

- 基础片：`VIDEO-B-105-FINAL-CUT-R02.mp4`
- 输出：`VIDEO-B-105-FINAL-CUT-R03-LOCAL-AI.mp4`
- 替换窗口：输出 00:15–00:26；原离线 Fixture 说明段被本地真实模型录屏替换。
- 新素材：`page@0d1b0ac792699fb6337ce2c8a4077dbc.webm`，来源 commit `7fb98ffd401d08fcc4188a03619fb420860cc2eb`。
- 真实范围：一次本地 DeepSeek `deepseek-flash` 请求，prompt“帮我做一个 25 分钟番茄钟”；HTTP 200，生成合法 AppSpec v2；B 自动打开；C 启动/倒计时、暂停、B/C 保持、重置通过。
- 画面：录屏原片 5.72 秒，800×500，25fps；缩放到 1920×1080 画布并以末帧延长至 11 秒。保留原 R02 旁白音轨。
- 画面标注：“本地真实 DeepSeek 验证｜单次生成 · 公网部署未验收”。
- 真实性边界：这不是公网部署验收；匿名请求 401；无 Mock/Replay/Fixture 注入；不包含密钥。
- 不宣称生产 PlanProvider、魔塔公网、公开访问或最终提交放行。

使用的 ffmpeg filter 逻辑：原片 `[0,15]` + 新录屏（缩放、加标注、末帧延长至 11 秒）+ 原片 `[26,105]`，音频取 R02 全片原旁白，输出 105 秒 H.264/AAC。
