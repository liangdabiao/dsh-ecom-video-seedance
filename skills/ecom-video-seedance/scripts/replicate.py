"""replicate.py —— 提示词包校验 + 渲染（零 API、零密钥）。

职责只有两件确定性的事：
  A. **硬校验**：提示词包字段是否齐全、每镜是否 ≤200 字、完整版是否 ≤800 字、
     分镜表是否合规、关键帧是否真的存在——不过就不放行，逼着改稿而不是交废稿。
  B. **渲染**：markdown + 自包含 HTML（每镜提示词旁配原片关键帧，逐镜对照）。

提示词内容由 agent 自己写（它是视觉模型，直接看帧），本脚本不调用任何模型。

用法：
  python replicate.py <video> --payload payload_faithful.json --style faithful   # 校验 + 渲染
  python replicate.py <video> --payload payload_faithful.json --check            # 只校验
  python replicate.py <video> --scaffold --style paid                            # 生成提示词包骨架
  python replicate.py <video> --payload p.json --shot A,B                        # 只渲染指定镜头
"""
import argparse
import base64
import hashlib
import html
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SKILL_DIR = Path(__file__).resolve().parents[1]
CACHE_ROOT = SKILL_DIR / ".cache"
OUT_DIR = Path("seedance-out")

SHOT_LIMIT = 200
FULL_LIMIT = 800

STYLE_DESC = {
    "faithful": "忠实复刻：尽最大程度还原原视频的画面、节奏与风格（仅把不可控元素替换为可控描述）",
    "organic": "自然流改版：在原视频结构基础上，按抖音自然流种草逻辑改写（真实场景、自然光、中景跟拍、痛点/种草叙事、无过度营销元素）",
    "paid": "付费流改版：在原视频结构基础上，按千川付费流逻辑改写（黄金3秒视觉奇观钩子、极致特写、硬光侧逆光、快节奏、结尾行动号召）",
}

PAYLOAD_KEYS = ["replication_strategy", "base_params", "shots", "full_prompt",
                "negative_prompt_cn", "negative_prompt_en", "reference_assets",
                "fidelity_notes", "upgrades"]


# ---------------------------------------------------------------- 读取

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_dir_for(video: Path) -> Path:
    return CACHE_ROOT / sha256_file(video)[:16]


def load_manifest(video: Path) -> dict:
    path = cache_dir_for(video) / "manifest.json"
    if not path.is_file():
        sys.exit(f"[error] 没有感知缓存，请先跑：python scripts/analyze.py \"{video}\"")
    return json.loads(path.read_text("utf-8"))


def load_storyboard(video: Path, explicit=None) -> tuple:
    """返回 (storyboard, cache_dir)。缺 storyboard.json 时报错并给出写稿指引。"""
    cache = cache_dir_for(video)
    path = Path(explicit).expanduser().resolve() if explicit else cache / "storyboard.json"
    if not path.is_file():
        sys.exit(
            f"[error] 没有分镜表 {path}\n"
            "  下一步由你（agent）来完成：用 read_image 读帧后按 S-A-C-S-C 写 storyboard.json，\n"
            "  字段见 references/storyboard-schema.md；写完再跑本脚本渲染。")
    return json.loads(path.read_text("utf-8")), cache


def load_payload(path_arg, style) -> Path:
    if path_arg:
        p = Path(path_arg).expanduser().resolve()
        if not p.is_file():
            sys.exit(f"[error] 找不到提示词包：{p}")
        return p
    for cand in (Path(f"payload_{style}.json"), Path("payload.json")):
        if cand.is_file():
            return cand.resolve()
    sys.exit(f"[error] 没有提示词包。先用 --scaffold 生成骨架：\n"
             f"  python scripts/replicate.py <video> --scaffold --style {style}\n"
             "  填完内容再用 --payload payload_<style>.json 跑校验渲染。")


def count_chars(text: str) -> int:
    """按字符数计（含标点与空格），与技能里的「每镜 ≤200 字」口径一致。"""
    return len(str(text or "").strip())


# ---------------------------------------------------------------- 校验

def validate_storyboard(sb: dict) -> list:
    problems = []
    if not isinstance(sb.get("overall"), dict):
        problems.append("storyboard.json 缺 overall（全片带货全局分析）")
    else:
        for k in ("product", "framework", "flow_type", "selling_points"):
            if not sb["overall"].get(k):
                problems.append(f"overall 缺字段 {k}")
    shots = sb.get("shots")
    if not isinstance(shots, list) or not shots:
        problems.append("storyboard.json 缺 shots（镜头拆解卡数组）")
        return problems
    need = ("id", "start", "end", "shot_type", "camera_move", "lighting",
            "subject_person", "subject_product", "action_steps", "purpose")
    ids = []
    for i, s in enumerate(shots, 1):
        sid = s.get("id") or f"#{i}"
        ids.append(sid)
        for k in need:
            if k not in s or s.get(k) in ("", None, []):
                problems.append(f"镜头 {sid} 缺字段 {k}")
        steps = s.get("action_steps")
        if steps is not None and (not isinstance(steps, list) or len(steps) < 2):
            problems.append(f"镜头 {sid} 的 action_steps 至少要 2 步时序（写慢、写连续）")
        if isinstance(s.get("start"), (int, float)) and isinstance(s.get("end"), (int, float)) \
                and s["end"] <= s["start"]:
            problems.append(f"镜头 {sid} 的 end 必须大于 start")
    if len(set(ids)) != len(ids):
        problems.append("镜头 id 有重复")
    return problems


def validate_payload(data: dict, sb: dict, style: str, duration: int) -> tuple:
    """返回 (hard_problems, soft_notes)。一次报全，别让 agent 修一个问题跑一轮。"""
    hard, soft = [], []

    for k in PAYLOAD_KEYS:
        if k not in data:
            hard.append(f"提示词包缺字段 {k}")

    for k, label in (("replication_strategy", "复刻策略（2-3 句说清取舍）"),
                     ("base_params", "基础参数段（时长/比例/画质/帧率/质感约束）"),
                     ("fidelity_notes", "差异说明（LOGO/水印等不可控元素怎么处理）"),
                     ("negative_prompt_cn", "中文负面约束")):
        if k in data and not str(data.get(k) or "").strip():
            hard.append(f"{k} 不能为空：{label}")
    if "negative_prompt_en" in data and not str(data.get("negative_prompt_en") or "").strip():
        hard.append("negative_prompt_en 不能为空（英文负面提示词）")

    sb_ids = [s.get("id") for s in sb.get("shots", [])]
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        if "shots" in data:
            hard.append("shots 不能为空（每镜一条提示词）")
        return hard, soft

    ids = []
    for i, s in enumerate(shots, 1):
        sid = s.get("id") or f"#{i}"
        ids.append(sid)
        for k in ("id", "time", "prompt"):
            if not str(s.get(k, "")).strip():
                hard.append(f"提示词镜头 {sid} 缺字段 {k}")
        n = count_chars(s.get("prompt"))
        if n > SHOT_LIMIT:
            hard.append(f"镜头 {sid} 提示词 {n} 字，超过 {SHOT_LIMIT} 字上限（砍到 200 以内）")
        if not str(s.get("purpose", "")).strip():
            soft.append(f"镜头 {sid} 没写 purpose（用途：钩子/展示/对比/代入/促单）")
    if len(set(ids)) != len(ids):
        hard.append("提示词镜头 id 有重复")
    if set(sb_ids) - set(ids):
        hard.append(f"分镜表里的镜头 {sorted(set(sb_ids) - set(ids))} 没有对应提示词")
    if set(ids) - set(sb_ids):
        soft.append(f"提示词里多了分镜表没有的镜头 {sorted(set(ids) - set(sb_ids))}（新加镜头要同步进分镜表）")

    full = str(data.get("full_prompt") or "")
    n_full = count_chars(full)
    if "full_prompt" in data and n_full > FULL_LIMIT:
        hard.append(f"完整版 {n_full} 字，超过 {FULL_LIMIT} 字上限")
    for sid in ids:
        if full and sid not in full:
            soft.append(f"完整版里没看到镜头 {sid} 的时间锚点（建议 '镜头{sid}(0-3s)：…' 分段）")

    refs = data.get("reference_assets")
    if "reference_assets" in data:
        if not isinstance(refs, list) or not refs:
            hard.append("reference_assets 不能为空（@参考图清单：产品图/人物图怎么拍）")
        else:
            for i, r in enumerate(refs, 1):
                if not isinstance(r, dict) or not str(r.get("name", "")).strip():
                    hard.append(f"reference_assets[{i}] 要有 name（如 @产品参考图1）")
                elif not str(r.get("how", "")).strip():
                    hard.append(f"reference_assets[{i}]（{r.get('name')}）要有 how（怎么拍/怎么准备）")

    ups = data.get("upgrades")
    if "upgrades" in data and (not isinstance(ups, list) or not ups):
        hard.append("upgrades 不能为空（1-3 条升级建议）")

    # 时长对齐（软提示）：镜头 time 加起来与目标时长的偏差
    spans = []
    for s in shots:
        m = re.findall(r"([0-9]+(?:\.[0-9]+)?)", str(s.get("time", "")))
        if len(m) >= 2:
            try:
                spans.append(float(m[1]) - float(m[0]))
            except ValueError:
                pass
    if spans:
        total = sum(spans)
        if abs(total - duration) > 0.6:
            soft.append(f"镜头时长合计约 {total:.1f}s，与目标 {duration}s 不一致（可等比缩放时间锚点）")
    if style not in STYLE_DESC:
        soft.append(f"未知风格 {style}（可用：{' / '.join(STYLE_DESC)}）")
    return hard, soft


def report(hard, soft, header="校验") -> bool:
    print(f"\n=== {header} ===")
    if hard:
        print(f"  ✗ {len(hard)} 项必须修：")
        for p in hard:
            print(f"    - {p}")
    if soft:
        print(f"  ! {len(soft)} 项建议修：")
        for p in soft:
            print(f"    - {p}")
    if not hard and not soft:
        print("  全部通过（0 个必须修 / 0 个建议修）")
    print(f"  结论：{'不通过（改完再跑）' if hard else '通过'}")
    return not hard


# ---------------------------------------------------------------- 骨架

def write_scaffold(sb, manifest, style, out: Path, duration: int) -> Path:
    shots = sb.get("shots") if sb else (manifest or {}).get("shots") or []
    data = {
        "_how": "这是骨架：把每个空字符串填成真实内容，再用 --payload 跑校验渲染。"
                "字段含义见 references/storyboard-schema.md。",
        "replication_strategy": "",
        "base_params": "",
        "shots": [{"id": s.get("id"), "time": f"{s.get('start', 0)}-{s.get('end', 0)}s",
                   "purpose": "", "prompt": ""} for s in shots],
        "full_prompt": "",
        "negative_prompt_cn": "",
        "negative_prompt_en": "",
        "reference_assets": [{"name": "@产品参考图1", "how": ""}, {"name": "@人物参考图1", "how": ""}],
        "fidelity_notes": "",
        "upgrades": [""],
    }
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"payload_{style}.skeleton.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    print(f"[scaffold] 骨架已写入 {path.resolve()}")
    print(f"  按原片 {duration}s、{len(shots)} 个镜头填内容（每镜 ≤{SHOT_LIMIT} 字，完整版 ≤{FULL_LIMIT} 字）")
    return path


# ---------------------------------------------------------------- 渲染

def render_markdown(sb, data, style, video_name, budgets) -> str:
    o = sb.get("overall", {})
    L = [f"# Seedance 复刻提示词 · {video_name}",
         "",
         f"**风格**：{STYLE_DESC.get(style, style)}  ",
         f"**原片判断**：{o.get('product', '')}｜{o.get('framework', '')}｜{o.get('flow_type', '')}  ",
         f"**拆解方式**：agent 直接读关键帧完成（零 API 密钥）｜镜头 "
         f"{len(sb.get('shots') or [])} 个｜目标 {budgets.get('duration')}s",
         "",
         "## 复刻策略", "", str(data.get("replication_strategy", "")), "",
         "## 基础参数（拼在提示词开头）", "", "```", str(data.get("base_params", "")), "```", "",
         "## 分镜头提示词", ""]
    for s in data.get("shots") or []:
        L.append(f"### 镜头{s.get('id', '?')}（{s.get('time', '')}）· {s.get('purpose', '')}")
        L.append("")
        L.append(f"_{count_chars(s.get('prompt'))} 字_")
        L.append("")
        L.append("```")
        L.append(str(s.get("prompt", "")))
        L.append("```")
        L.append("")
    L += ["## 完整版（直接粘贴即梦）", "", "```", str(data.get("full_prompt", "")), "```", "",
          f"_完整版 {count_chars(data.get('full_prompt'))} 字（上限 {FULL_LIMIT}）_", "",
          "## 负面提示词", "",
          f"- 中文约束：`{data.get('negative_prompt_cn', '')}`", "",
          f"- 英文：`{data.get('negative_prompt_en', '')}`", "",
          "## @参考图清单", ""]
    for r in data.get("reference_assets") or []:
        L.append(f"- **{r.get('name', '')}**：{r.get('how', '')}")
    L += ["", "## 与原片的差异说明", "", str(data.get("fidelity_notes", "")), "",
          "## 升级建议", ""]
    for u in data.get("upgrades") or []:
        L.append(f"- {u}")
    L.append("")
    return "\n".join(L)


def render_html(sb, data, style, cache_dir, duration) -> str:
    kf_map = sb.get("keyframes") or {}
    banner = (f"{html.escape(sb.get('video_name', ''))} · {STYLE_DESC.get(style, style)} · "
              f"目标 {duration}s · 拆解与编导由 agent 直接读帧完成（零 API 密钥）")
    parts = [f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Seedance 复刻提示词</title>
<style>
body{{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#222;line-height:1.65}}
.meta{{color:#666;font-size:13px}}
h1{{margin-bottom:4px}}
h2{{margin-top:34px;border-bottom:2px solid #e8e8e8;padding-bottom:6px;font-size:18px}}
h3{{margin:0 0 8px;font-size:15px}}
.shot{{margin:18px 0;padding:14px 18px;background:#f6f7f9;border-radius:10px}}
.prompt{{white-space:pre-wrap;background:#fff;border:1px solid #e3e3e8;padding:12px 16px;border-radius:8px;font-size:14px}}
.full{{white-space:pre-wrap;background:#fff;border:1px solid #e3e3e8;padding:14px 18px;border-radius:8px;font-size:14px}}
img{{width:100%;border:1px solid #ddd;border-radius:6px;margin:4px 0}}
.kfs{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}}
.tag{{display:inline-block;background:#eceefe;color:#4a4fbe;border-radius:6px;padding:1px 8px;font-size:12px;margin-left:6px}}
.tag.warn{{background:#fdeee8;color:#b4462a}}
code{{background:#e8e8ec;padding:1px 5px;border-radius:3px}}
</style></head><body>
<h1>Seedance 复刻提示词</h1>
<div class="meta">{banner}</div>"""]
    for s in data.get("shots") or []:
        sid = str(s.get("id", ""))
        n = count_chars(s.get("prompt"))
        tag = f'<span class="tag">{n} 字</span>' if n <= SHOT_LIMIT else f'<span class="tag warn">{n} 字 超限</span>'
        parts.append(f'<div class="shot"><h3>镜头{html.escape(sid)}（{html.escape(str(s.get("time", "")))}）· '
                     f'{html.escape(str(s.get("purpose", "")))} {tag}</h3>')
        parts.append(f'<div class="prompt">{html.escape(str(s.get("prompt", "")))}</div>')
        kfs = kf_map.get(sid) or []
        if kfs:
            parts.append('<div class="kfs">')
            for item in kfs:
                p, t = (item if isinstance(item, (list, tuple)) and len(item) == 2 else (item, ""))
                fp = Path(str(p))
                if not fp.is_file():
                    fp = cache_dir / "frames" / fp.name
                if fp.is_file():
                    b64 = base64.b64encode(fp.read_bytes()).decode()
                    parts.append(f'<div><img alt="t={t}s" src="data:image/jpeg;base64,{b64}">'
                                 f'<div class="meta">t={t}s</div></div>')
            parts.append("</div>")
        parts.append("</div>")
    parts.append(f'<h2>完整版（直接粘贴即梦）</h2><div class="full">{html.escape(str(data.get("full_prompt", "")))}</div>')
    parts.append(f'<h2>负面提示词</h2><div class="prompt">中文约束：{html.escape(str(data.get("negative_prompt_cn", "")))}'
                 f'\n\n英文：{html.escape(str(data.get("negative_prompt_en", "")))}</div>')
    parts.append("<h2>@参考图清单</h2><ul>")
    for r in data.get("reference_assets") or []:
        parts.append(f"<li><b>{html.escape(str(r.get('name', '')))}</b>：{html.escape(str(r.get('how', '')))}</li>")
    parts.append("</ul>")
    parts.append(f'<h2>与原片的差异说明</h2><div class="prompt">{html.escape(str(data.get("fidelity_notes", "")))}</div>')
    parts.append("<h2>升级建议</h2><ul>")
    for u in data.get("upgrades") or []:
        parts.append(f"<li>{html.escape(str(u))}</li>")
    parts.append("</ul></body></html>")
    return "".join(parts)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="提示词包校验 + 渲染（零 API）")
    ap.add_argument("video", type=Path)
    ap.add_argument("--payload", default="", help="提示词包 JSON（默认找 payload_<style>.json / payload.json）")
    ap.add_argument("--storyboard", default="", help="分镜表路径（默认 .cache/<sha16>/storyboard.json）")
    ap.add_argument("--style", choices=list(STYLE_DESC), default="faithful")
    ap.add_argument("--duration", type=int, default=15, help="目标成片时长（4-15 秒）")
    ap.add_argument("--shot", default="", help="只渲染指定镜头，如 A,B")
    ap.add_argument("--check", action="store_true", help="只校验，不渲染")
    ap.add_argument("--scaffold", action="store_true", help="生成提示词包骨架后退出")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()

    video = args.video.expanduser().resolve()
    if not video.is_file():
        sys.exit(f"[error] 找不到视频：{video}")
    manifest = load_manifest(video)

    if args.scaffold:
        sb_path = cache_dir_for(video) / "storyboard.json"
        sb = json.loads(sb_path.read_text("utf-8")) if sb_path.is_file() else None
        write_scaffold(sb, manifest, args.style, args.out, args.duration)
        return

    sb, cache = load_storyboard(video, args.storyboard or None)
    payload_path = load_payload(args.payload or None, args.style)
    data = json.loads(payload_path.read_text("utf-8"))

    print(f"[replicate] {sb.get('video_name', video.name)}: {len(sb.get('shots') or [])} 镜, "
          f"style={args.style}, duration={args.duration}s")
    print(f"[replicate] 分镜表：{cache / 'storyboard.json' if not args.storyboard else args.storyboard}")
    print(f"[replicate] 提示词包：{payload_path}")

    ok_sb = report(validate_storyboard(sb), [], header="分镜表校验")
    hard, soft = validate_payload(data, sb, args.style, args.duration)
    print("\n=== 字数（单镜 ≤200 / 完整版 ≤800）===")
    for s in data.get("shots") or []:
        n = count_chars(s.get("prompt"))
        print(f"  镜头{s.get('id')} {s.get('time')}: {n} 字 [{'OK' if n <= SHOT_LIMIT else 'OVER'}]")
    print(f"  完整版: {count_chars(data.get('full_prompt'))} 字 [{'OK' if count_chars(data.get('full_prompt')) <= FULL_LIMIT else 'OVER'}]")
    ok_payload = report(hard, soft, header="提示词包校验")
    if not (ok_sb and ok_payload):
        sys.exit(1)
    if args.check:
        print("\n[check] 只校验，未渲染。")
        return

    keep = {x.strip().upper() for x in args.shot.split(",")} if args.shot else None
    if keep:
        data = dict(data)
        data["shots"] = [s for s in data["shots"] if str(s.get("id", "")).upper() in keep]

    md = render_markdown(sb, data, args.style, sb.get("video_name", video.name),
                         {"duration": args.duration})
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    stem = str(sb.get("video_name", video.name)).rsplit(".", 1)[0][:40]
    tag = {"faithful": "忠实复刻", "organic": "自然流", "paid": "付费流"}[args.style]
    md_path = out / f"{stem}_{tag}_提示词.md"
    html_path = out / f"{stem}_{tag}_提示词.html"
    md_path.write_text(md, encoding="utf-8")
    html_path.write_text(render_html(sb, data, args.style, cache, args.duration), encoding="utf-8")

    print("\n=== 产出文件 ===")
    print(f"  HTML 预览（双击打开，逐镜对照关键帧）：{html_path}")
    print(f"  Markdown（方便复制）：{md_path}")


if __name__ == "__main__":
    main()
