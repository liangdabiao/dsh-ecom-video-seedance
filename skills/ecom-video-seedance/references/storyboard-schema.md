# 数据结构与校验规则

三个产物：`manifest.json`（脚本产出）、`storyboard.json`（**你写**）、`payload_<style>.json`（**你写**）。
校验器按本文件的字段名卡，写错字段名直接过不去。

## 1. manifest.json（analyze.py 产出，只读）

`.cache/<sha256前16位>/manifest.json`

```jsonc
{
  "video": "绝对路径", "video_name": "xxx.mp4",
  "sha256": "完整 sha", "sha16": "前16位", "cache_dir": "缓存目录绝对路径",
  "created": "ISO 时间",
  "duration": 15.02, "width": 480, "height": 854, "ratio": "9:16",
  "has_audio": true,
  "sample_fps": 1.0,
  "scene_cuts": [3.0, 5.97, 8.97, 11.93],     // ffmpeg scene>0.25 检测到的剪辑点
  "min_shot": 0.8,
  "shots": [
    {
      "id": "A", "start": 0.0, "end": 3.0, "duration": 3.0,
      "frames": [
        {"t": 0.0, "path": "frames/f_00000.jpg", "abs": "D:\\...\\frames\\f_00000.jpg"}
      ]
    }
  ],
  "next": ["下一步该干什么"]
}
```

- 帧按 1fps 抽（>120s 降 0.5fps），`t` 是秒，`abs` 是给 `read_image` 用的绝对路径。
- 镜头区间**左闭右开**（末镜含尾帧），所以剪辑点上的帧不会同时属于前后两镜。

## 2. storyboard.json（你写 → `.cache/<sha16>/storyboard.json`）

```jsonc
{
  "video": "绝对路径", "video_name": "xxx.mp4", "sha256": "…", "duration": 15.02,
  "width": 480, "height": 854,
  "agent": "deepseek agent 视觉直接读帧（零 API）",   // 标明拆解方式，进 HTML 页头
  "scene_cuts": [3.0, 5.97, 8.97, 11.93],
  "overall": {
    "product": "带货产品判断：品名/品牌/品类（画面水印也算线索）",
    "category": "美妆/食品/3C/家居/服饰/母婴/其他",
    "person_setting": "出镜人物设定（无人出镜写空字符串）",
    "framework": "口播介绍型/场景代入型/对比测评型/细节种草型/剧情植入型/产品展示型",
    "flow_type": "自然流/付费流/通用 + 判断理由（有没有口播、字幕、价格贴片、节奏快慢）",
    "hook": "开头钩子类型与内容",
    "selling_points": ["全片核心卖点"],
    "script_summary": "口播/文案摘要（标注「推断」，本技能不分析音轨）",
    "rhythm": "节奏结构：每镜时长分配 + 情绪曲线",
    "cta": "行动号召，没有就写'无'并说明",
    "replicate_difficulty": "哪些元素易还原、哪些难（LOGO/水印/密集小图/多手）"
  },
  "shots": [
    {
      "id": "A", "start": 0.0, "end": 3.0, "duration": 3.0,
      "shot_type": "景别：极致特写/特写/近景/中景/全景/远景（可加括号说明取景范围）",
      "angle": "视角：俯拍/平视/仰拍 + 机位说明",
      "dof": "景深：浅(背景虚化)/深(前后清晰)",
      "camera_move": "运镜 + 速度：固定镜头/缓慢推镜(dolly in)/平稳横移(pan)/跟拍/拉远…",
      "lighting": "光源类型 + 光位 + 质感（柔光箱/侧逆光/丁达尔/眼神光…）",
      "color": "色调 + 饱和度 + 对比度",
      "subject_person": "四层：身份→外貌→服装(具体颜色)→气质表情(物理描述)；无人写空字符串",
      "subject_product": "品类 + 外观 + 颜色 + 材质 + 可见文字/LOGO",
      "setting": "场景类型 + 风格 + 环境细节",
      "action_steps": ["时序步骤1", "时序步骤2", "时序步骤3"],   // 至少 2 步，建议 3-5 步
      "interaction": "物理交互（手指轻触/发丝回弹/雾粒飘散），无则空字符串",
      "onscreen_text": "画面内可见文字/水印，无则空字符串",
      "audio_cues": "从画面推断的声音线索（注明推断）",
      "selling_point": "本镜承载的卖点",
      "purpose": "黄金3秒钩子/卖点展示/效果对比/场景代入/信任建立/促单行动号召"
    }
  ],
  "keyframes": {                       // 给 HTML 配图用：镜头 id → [[帧绝对路径, 秒], …]
    "A": [["D:\\…\\f_00000.jpg", 0.0], ["D:\\…\\f_00001.jpg", 1.0]]
  }
}
```

硬校验（`validate_storyboard`）：`overall` 必须是对象且含 product/framework/flow_type/selling_points；
每镜必须有 id/start/end/shot_type/camera_move/lighting/subject_person/subject_product/action_steps/purpose；
`action_steps` ≥2 步；id 不重复；end > start。

## 3. payload_<style>.json（你写 → 当前工作区）

```jsonc
{
  "replication_strategy": "复刻策略 2-3 句：怎么理解原片、这版取舍了什么",
  "base_params": "15秒，9:16竖屏，1080P高清，30fps帧率，电影质感，画面丝滑无卡顿，无抖动无闪烁，细节丰富，锐度清晰，色彩自然还原，主体结构正常比例自然",
  "shots": [
    {"id": "A", "time": "0-3s", "purpose": "黄金3秒钩子·造型亮相", "prompt": "≤200 字，S-A-C-S-C 齐全，尾部带约束"}
  ],
  "full_prompt": "≤800 字，按 '镜头A(0-3s)：…' 分段拼成整段，可直接粘进即梦",
  "negative_prompt_cn": "中文负面约束（拼在正向尾部）",
  "negative_prompt_en": "英文负面提示词",
  "reference_assets": [{"name": "@产品参考图1", "how": "怎么拍/怎么准备"}],
  "fidelity_notes": "与原片的差异说明：哪些元素不可控、怎么处理（后期贴水印/去logo替代/多手降级）",
  "upgrades": ["1-3 条升级建议"]
}
```

硬校验（`validate_payload`，全量报错再 exit 1）：

| 规则 | 说明 |
|---|---|
| 9 个顶层字段齐全 | `replication_strategy` / `base_params` / `shots` / `full_prompt` / `negative_prompt_cn` / `negative_prompt_en` / `reference_assets` / `fidelity_notes` / `upgrades` |
| 每镜 ≤200 字 | 按字符数计（含标点），超了砍 |
| 完整版 ≤800 字 | 同上 |
| 每镜字段 | `id` / `time` / `prompt` 必填，`purpose` 缺失只是警告 |
| 镜头对齐分镜表 | 提示词镜头的 id 集合必须覆盖分镜表；多了只警告 |
| reference_assets | 每项 `name` + `how` 都要有 |
| upgrades | 非空数组 |

软警告（不拦，但会提示）：purpose 缺失、完整版里缺某镜锚点、镜头时长合计与 `--duration` 偏差 >0.6s、
出现分镜表里没有的新镜头。

## 4. 渲染产物

`seedance-out/<视频名>_<风格>_提示词.{md,html}`，风格中文名：faithful→忠实复刻、organic→自然流、paid→付费流。
HTML 自包含（帧以 base64 内嵌），每镜提示词旁是原片关键帧 + 字数标签（超限标红）。

## 5. 分镜表存档（插件工作台）

`seedance_storyboard action=save`，`scenes` 转成工作台格式：

```jsonc
[{"shot": "镜头A 造型亮相（0-3s）", "narration": "口播/推断文案", "visual": "画面要点", "duration": 3}]
```

每存一次多一版；`history` 可看历史，`restore` 能从删除快照恢复。
