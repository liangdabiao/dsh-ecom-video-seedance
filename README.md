# dsh-ecom-video-seedance · 带货视频拆解

DeepSeek Harness（dsh）插件：**带货视频反向拆解与 Seedance 复刻提示词生成**——把带货爆款视频"看懂"（拆成镜头卡片），"翻译"成即梦（Seedance）能直接执行的提示词。支持忠实复刻/自然流/付费流三种风格。
侧栏是「带货视频拆解」工作台（布局对齐「投资尽调」）：概览 / 我的分镜 / 生成历史 / 拆解·创作 / S-A-C-S-C 规范。

**零 API 密钥**：抽帧切镜、字数校验、md/HTML 渲染都是本地脚本（ffmpeg + Python 标准库）；
看帧拆解与提示词编导由 **agent 自己的视觉能力**完成（`read_image` 直接读关键帧），不调外部视觉模型、不联网。

技能来自 [ecom-video-seedance-prompt](https://github.com/liangdabiao/ecom-video-seedance-prompt)（liangdabiao），本插件把它改成了 agent 原生实现。

<img width="1686" height="1011" alt="image" src="https://github.com/user-attachments/assets/ab11b959-1f7c-457a-8fdf-4cc6f43698a7" />
<img width="2502" height="1116" alt="image" src="https://github.com/user-attachments/assets/3dad0f63-4f20-4348-a2a5-6ada43ae49ad" />
<img width="1704" height="1464" alt="image" src="https://github.com/user-attachments/assets/ebd7b635-67d6-4247-ab56-35160116de65" />



## 装了什么

| 能力 | 说明 |
|---|---|
| skill `ecom-video-seedance-prompt` | 随包快照：SKILL.md + references（S-A-C-S-C 编导规范、manifest/storyboard/payload 字段定义与校验规则）+ `analyze.py`（感知准备）/ `replicate.py`（校验+渲染），两个脚本都不联网 |
| `seedance_storyboard` | 分镜表持久化：save 保存（**每保存一次多一版**）/ list / get（渲染 Seedance 分段提示）/ delete / history / stats / restore |
| 侧栏工作台 | `/ecom-video-seedance/`：概览 · 我的分镜 · 分镜详情 · 生成历史 · 拆解·创作 · S-A-C-S-C |

## 使用

对话里：**「拆解这条带货视频，生成 Seedance 复刻提示词：<视频路径或URL>」**

流程（agent 自己执行，全程零密钥）：

1. `python scripts/analyze.py "<视频>"` —— ffprobe + 1fps 抽帧 + 场景切换切镜，打印每镜关键帧绝对路径
2. agent `read_image` 逐镜读帧（并发 6-8 张），跨镜比对动作/光位/卷度，按 S-A-C-S-C 写
   `storyboard.json` + `payload_<style>.json`
3. `python scripts/replicate.py "<视频>" --payload payload_<style>.json --style faithful` ——
   硬校验（每镜 ≤200 字 / 完整版 ≤800 字 / 字段齐全 / 镜头对齐 / @参考图有准备办法），通过后渲染 md + 自包含 HTML
4. `seedance_storyboard action=save` 存进工作台，侧栏回看、逐镜改、看历史

## 侧栏工作台

| 页面 | 内容 |
|---|---|
| 概览 | 分镜表 / 镜头合计 / 时长合计 / 版本数 / 历史事件；最近分镜、最近动作 |
| 我的分镜 | 卡片列表（产品、风格、镜数、时长、第几版、更新时间），可搜索 |
| 分镜详情 | 镜头表（镜/镜头/画面/口播/时长）、Seedance 分段提示（一键复制）、版本历史（每版改了什么）、在对话里改、删除 |
| 生成历史 | 新建 / 更新 / 删除 / 恢复事件流，可按类型筛、搜关键词；点开看当次详情，**删除的记录带快照，可一键恢复** |
| 拆解·创作 | 填视频路径/产品/风格/时长 → 打开新对话并带上「抽帧 → 看帧拆解 → 校验渲染 → 存分镜表」指令；**视频路径可点「浏览…」弹系统文件框选择**；没有原片可直接写脚本 |
| S-A-C-S-C | 五要素表、三步流程、交付规范、常见问题、随包技能 |

## 选视频（浏览…）

「拆解·创作」里的视频路径输入框右边有「浏览…」按钮：点它由**宿主进程**弹出系统原生的「打开文件」对话框，选完自动把绝对路径填进输入框。

- 浏览器里的 `<input type="file">` 拿不到绝对路径（安全限制），所以这一步必须走宿主：
  页面 `POST /api/pick` → `lib/picker.js` 用 PowerShell 调 `System.Windows.Forms.OpenFileDialog`（脚本走 `-EncodedCommand`，中文滤镜不会坏），取消返回 `cancelled`，出错透传原因。
- 目前只有 **Windows** 支持原生弹窗（`catalog.capabilities.pickVideo` 会告诉页面）；macOS / Linux 按钮置灰并提示手填。
- 也支持在输入框里直接粘贴路径、粘贴 URL，或拖拽——但拖进浏览器拿不到路径，所以拖拽不生效。

## 环境

- **ffmpeg / ffprobe 在 PATH**（脚本会自检并给安装提示）
- Python 3.8+，只用标准库（不需要 `pip install openai` 之类）
- **不需要 API key，不需要联网**

## 数据目录

`$DSH_HOME/ecom-video-seedance/`（默认 `C:\Users\<你>\.dsh\ecom-video-seedance\`）

- `storyboards.json`：分镜表 + 每版快照（每张最多留 20 版，最多 100 张表）
- `history.json`：新建/更新/删除/恢复事件（最多 300 条，删除事件带 `snapshot` 可恢复）

页面和 `seedance_storyboard` 工具的 `history` / `stats` 动作读的是同一份数据。

## 自检

```bash
npm install
npm test                      # 快照 + 零 API 校验 + provider + 数据层 + 工具全链路（9 项，零网络）
npm run selftest              # 同上再跑一遍离线自检
node scripts/api-test.mjs     # 起本地 http 打一遍工作台接口（24 项，不碰真实数据）
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
