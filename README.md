# dsh-ecom-video-seedance · 带货视频拆解

DeepSeek Harness（dsh）插件：**带货视频反向拆解与 Seedance 复刻提示词生成**——把带货爆款视频"看懂"（拆成镜头卡片），"翻译"成即梦（Seedance）能直接执行的提示词。支持忠实复刻/自然流/付费流三种风格。

技能来自 [ecom-video-seedance-prompt](https://github.com/liangdabiao/ecom-video-seedance-prompt)（liangdabiao）。

## 使用

对话里：**「拆解这条带货视频，生成 Seedance 复刻提示词：<视频路径或URL>」**

模型按 S-A-C-S-C 编导规范 → 镜头级分镜表（景别/运镜/光影/动作时序/卖点）→ 完整提示词包（分镜头+基础参数+负面词+参考图清单）。

## 自检

```bash
npm install && npm test && npm run selftest && npm run build
```

## 许可

MIT（liangdabiao）
