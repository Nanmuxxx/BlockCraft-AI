# BlockCraft AI 初赛 105 秒视频交付 R02

日期：2026-10-19（Asia/Shanghai）。**剪辑与文件验证完成；提交放行仍为 PARTIAL/BLOCKED pending human review and official requirements.** 此状态不表示 Tech Lead、评委或素材负责人已批准。没有上传。

## 输出

- `exports/VIDEO-B-105-FINAL-CUT-R02.mp4`：105.00 秒，3150 帧，1920×1080，30fps，H.264/yuv420p，AAC mono 48kHz，9,395,867 字节。
- SHA-256：`ec7235be208a9b69084d12a8e2be4e393eb58209f6c8b97c05b471a1ce745274`。
- `exports/VIDEO-B-105-FINAL-CUT-R02.srt`：与成片烧录字幕一致；SHA-256 `8d0b08b897f805d155573418cb93f2436f6909a8df4b8ce1dbf280f1457219ff`。
- `exports/VIDEO-B-105-FINAL-CUT-R02-DELIVERY.zip`：MP4、SRT、验收报告、来源表和时间线。
- 全片/音轨解码通过（3150/3150 帧）；综合响度 -18.1 LUFS，LRA 4.2 LU，真峰值 -2.0 dBFS。静态联系表和技术卡原分辨率抽帧已检查。
- 剪辑复现脚本：`review/build-105-final-cut.py`；机器检查：`review/FINAL-CUT-QA.json`；镜头映射：`review/FINAL-CUT-TIMELINE.json`、`review/FINAL-CUT-SOURCES.csv`。

## 版本基准与来源

- Issue #57 [Video 决策](https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6268988241) 指定来源/版本、离线与历史回放标识及官方规则待核条件。当前协调基准 main：`4a95cae50f772cd242d932cdbd93366381d1df74`。Supervisor 说明该次前进只有协调文件；[QA 最近报告](https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6269011836) 绑定并重复验证此 main 的离线基线。
- 产品树基线：`8cfa37f5112adaab1e0adbb4cb4086240111d436`，tree `8c6b049314267326b6e3cb356c0096860dbbad79`；与 Workshop 已测树相同。产品源码本轮没有改动。报告中的技术状态依据代码和离线测试，不是当前产品实时录屏。
- B 实际操作原片来自王致远候选 `7e94dc9568501dd4ad218a43b5aca31026aed2b2`。C 实际操作原片来自金运梓候选 `a1fa7550744ac5189d9dad7fb758d16437d4b66d`。各自来源及画面时点在来源 CSV 中记录。
- 两段原片来自不同候选版本、不同独立录制会话；没有统一冻结到当前 main，片头状态条和 Mochi 技术卡明确标出“统一冻结待确认”。不把它们表现成同一连续会话或当前 main 的录屏。
- “main 4a95cae / 产品树同 8cfa37f”分别说明协调提交头和产品代码树基线；不得将 B/C 原片候选哈希解读为产品冻结版本。

## 能力与证据边界

- B Inspector、字段配置、拖拽及 C CRUD/统计保留为对应录屏候选的实际界面操作，仍需金运梓按展示画面复核。
- 真实操作镜头的版本标签逐镜保留；C 慢放和静态关键帧已有画面标识。没有补造按钮、点击或运行成功结果。
- Mochi Engine / Workshop B/C 的合并、隔离测试中的 Preview/Confirm 与 B/C 投影，来自 [同树集成验收报告](../../../reports/workshop-pr51-main-20261019/INTEGRATION-REPORT.md)、本地测试记录及 [main 的 Host 接线](../../../BlockCraft-AI/src/components/app-builder/AppSpecWorkshop.tsx)。测试使用固定 JSON Fixture；不是真实模型调用，不等于生产 PlanProvider 接通。
- 正式 PlanProvider 仍禁用；公网部署未完成。没有实时 DeepSeek/魔塔在线生成画面。不得宣传任意 React/TSX 安全执行。
- 系统晓晓合成旁白标为“旁白：系统合成语音”。B10 新句旁白及 SRT 来自同一经授权文本和语音；没有克隆真人声音。
- 保留产品定位、Mochi 形象、B/C 工作台、报名工具真实操作和原主要叙事。没有 ZIP 能力宣传。

## 时间轴

| 视频时间 | 内容 / 证据性质 |
| --- | --- |
| 00:00–00:15 | BP 场景、定位和品牌介绍 |
| 00:15–00:26 | B 候选录屏；固定离线 Fixture，非实时 DeepSeek |
| 00:26–00:42 | B 功能积木、原速拖拽、Inspector 配置 |
| 00:42–00:51 | B 同一原片的 C 预览及 0→1 |
| 00:51–00:55 | B/C 来源切换卡；C 是独立会话，基线 1 |
| 00:55–01:12.367 | C 候选连续原片，1.2–9.88 秒、0.5× |
| 01:12.367–01:24.5 | C 已交付关键帧静态放大；明确标识为静态结果 |
| 01:24.5–01:30 | 已验证能力与当前页面会话保留边界 |
| 01:30–01:39 | 当前 main 技术进度卡、Mochi 形象；明确不是在线运行录屏 |
| 01:39–01:45 | BP 产品愿景结尾 |

逐镜来源、输入 SHA、输入/输出时码、速度和裁切见 `FINAL-CUT-SOURCES.csv`。镜头次序承接 INTERNAL-R02，仅替换过时的 Mochi 进度卡/旁白并更新来源/冻结标识。

## 真实在线镜头替换接口

- 真实魔塔/DeepSeek 生成素材尚未收到，R02 未加入在线生成镜头。
- 预留窗口及必须证据见 `LIVE-ONLINE-SHOT-REPLACEMENT.md`；在请求、合法 AppSpec、B/C/Runtime 连续运行、魔塔 revision/digest、录屏哈希和负责人复核齐全前，不得替换或宣称在线能力已验收。

## 仍待确认

1. 人工播放器从头至尾观看及听审；中文读音、停顿、音量、衔接和 SRT 逐句同步仍没有真人回执。机器解码不代替听审。
2. 金运梓复核功能镜头；Mochi 品牌/技术负责人复核进度卡和产品声明；郑相确认原片是否可作为历史候选镜头及当前冻结意见。用户负责转交审片材料；本报告不声称其他负责人已审或签收。
3. 官方最大时长、MP4 编码/分辨率/文件大小、合成语音和跨版本剪辑政策、入口以及 2026-10-20 18:00 截止时区仍须以赛事方原文核实。
4. 新增魔塔公网真实生成原片和可审计验收证据未收到，因此不加入本版，也不阻塞现有离线剪辑。
5. 获 Tech Lead 定版和提交授权后才可将状态升级为正式提交版；此任务没有上传授权或上传操作。
