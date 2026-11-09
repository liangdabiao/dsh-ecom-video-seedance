# dsh-ecom-video-seedance · 带货视频拆解

DeepSeek Harness（dsh）插件：**带货视频反向拆解与 Seedance 复刻提示词生成**——把带货爆款视频"看懂"（拆成镜头卡片），"翻译"成即梦（Seedance）能直接执行的提示词。支持忠实复刻/自然流/付费流三种风格。
侧栏是「带货视频拆解」工作台（布局对齐「投资尽调」）：概览 / 我的分镜 / 生成历史 / 拆解·创作 / S-A-C-S-C 规范。

技能来自 [ecom-video-seedance-prompt](https://github.com/liangdabiao/ecom-video-seedance-prompt)（liangdabiao）。

## 装了什么

| 能力 | 说明 |
|---|---|
| skill `ecom-video-seedance-prompt` | 随包快照：SKILL.md + references（S-A-C-S-C 编导规范、分镜表 schema）+ analyze.py / replicate.py |
| `seedance_storyboard` | 分镜表持久化：save 保存（**每保存一次多一版**）/ list / get（渲染 Seedance 分段提示）/ delete / history / stats / restore |
| 侧栏工作台 | `/ecom-video-seedance/`：概览 · 我的分镜 · 分镜详情 · 生成历史 · 拆解·创作 · S-A-C-S-C |

## 使用

对话里：**「拆解这条带货视频，生成 Seedance 复刻提示词：<视频路径或URL>」**

模型按 S-A-C-S-C 编导规范 → 镜头级分镜表（景别/运镜/光影/动作时序/卖点）→ 完整提示词包（分镜头+基础参数+负面词+参考图清单），
收尾时用 `seedance_storyboard action=save` 存进插件，侧栏里能回看、逐镜改、看历史。

## 侧栏工作台

| 页面 | 内容 |
|---|---|
| 概览 | 分镜表 / 镜头合计 / 时长合计 / 版本数 / 历史事件；最近分镜、最近动作 |
| 我的分镜 | 卡片列表（产品、风格、镜数、时长、第几版、更新时间），可搜索 |
| 分镜详情 | 镜头表（镜/镜头/画面/口播/时长）、Seedance 分段提示（一键复制）、版本历史（每版改了什么）、在对话里改、删除 |
| 生成历史 | 新建 / 更新 / 删除 / 恢复事件流，可按类型筛、搜关键词；点开看当次详情，**删除的记录带快照，可一键恢复** |
| 拆解·创作 | 填视频路径/产品/风格/时长 → 打开新对话并带上「拆解 → 复刻提示词 → 存分镜表」指令；没有原片可直接写脚本 |
| S-A-C-S-C | 五要素表、三步流程、交付规范、常见问题、随包技能 |

**数据目录**：`$DSH_HOME/ecom-video-seedance/`（默认 `C:\Users\<你>\.dsh\ecom-video-seedance\`）

- `storyboards.json`：分镜表 + 每版快照（每张最多留 20 版，最多 100 张表）
- `history.json`：新建/更新/删除/恢复事件（最多 300 条，删除事件带 `snapshot` 可恢复）

页面和 `seedance_storyboard` 工具的 `history` / `stats` 动作读的是同一份数据。

## 自检

```bash
npm install
npm test                      # 快照 + provider + 数据层 + 工具全链路（5 项，零网络）
npm run selftest              # 同上再跑一遍离线自检
node scripts/api-test.mjs     # 起本地 http 打一遍工作台接口（20 项，不碰真实数据）
npm run build                 # client.js → dist/client.js（宿主加载的是这个产物）
```

`npm test` / `api-test` 都会把 `DSH_HOME` 指到 `.tmp/`，不会写你的真实分镜表。

## 安装

```bash
dsh plugin --profile web add dsh-ecom-video-seedance
```

本地开发（link 安装）时，宿主只认 profile 的 `dsh.profile.bundles`；改了 `lib/`、`src/` 需要重启一次 DeepSeek Harness，
改了 `client.js` 要先 `npm run build` 再刷新页面。

## 许可

MIT（liangdabiao）
