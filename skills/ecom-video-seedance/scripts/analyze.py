"""analyze.py —— 镜头感知准备（零 API、零密钥、只用 ffmpeg + 标准库）。

这一步只做确定性的事，把"看视频"的素材备好：
  1. ffprobe 取元信息（时长 / 分辨率 / 画面比例）
  2. 1fps 抽帧（>120s 自动降 0.5fps）→ .cache/<sha16>/frames/
  3. ffmpeg 场景切换检测（scene>0.25）→ 剪辑点
  4. 剪辑点切分镜头（合并时长 < --min-shot 的碎片）
  5. 每个镜头挑首 / 1/4 / 中 / 3/4 / 尾关键帧，给出绝对路径清单
  6. 落盘 .cache/<sha16>/manifest.json，并打印"该读哪些帧"

**本脚本不调用任何模型。** 看帧拆解和提示词编导由 agent 自己做：
  · 用 read_image 逐镜读关键帧（一次并发 6-8 张），按 S-A-C-S-C 写 storyboard.json
  · 再写提示词包 payload_<style>.json
  · 跑 replicate.py 做字数/字段硬校验并渲染 md + HTML

用法：
  python analyze.py <video> [--fps auto] [--min-shot 0.8] [--force] [--clean] [--json]
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SKILL_DIR = Path(__file__).resolve().parents[1]
CACHE_ROOT = SKILL_DIR / ".cache"
MAX_SIDE_PX = 3600
SCENE_THRESHOLD = 0.25
MAX_KEYFRAMES = 4


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def need(tool: str) -> None:
    if not shutil.which(tool):
        sys.exit(f"[error] 找不到 {tool}，请先安装并确保在 PATH 里（Windows 可用 winget install ffmpeg）。")


def run(cmd, timeout):
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout)
    return r


def ffprobe(path: Path) -> dict:
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
             str(path)], 120)
    if r.returncode != 0:
        sys.exit(f"[error] ffprobe 失败：{(r.stderr or '').strip()[:300]}")
    data = json.loads(r.stdout or "{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        sys.exit("[error] 这个文件里没有视频流。")
    duration = float(data.get("format", {}).get("duration", 0) or 0)
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    return {"width": int(v["width"]), "height": int(v["height"]),
            "duration": round(duration, 2), "has_audio": has_audio}


def extract_frames(video: Path, out_dir: Path, fps: float) -> list:
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(out_dir.glob("f_*.jpg"))
    if files:
        return files
    vf = f"fps={fps}"
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height", "-of", "csv=p=0", str(video)], 60)
    try:
        w, h = (int(x) for x in (r.stdout or "").strip().split(",")[:2])
        if max(w, h) > MAX_SIDE_PX:
            vf += f",scale={MAX_SIDE_PX}:{MAX_SIDE_PX}:force_original_aspect_ratio=decrease"
    except (ValueError, TypeError):
        pass
    r = run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf", vf, "-q:v", "3",
             "-start_number", "0", str(out_dir / "f_%05d.jpg")], 1800)
    if r.returncode != 0:
        sys.exit(f"[error] ffmpeg 抽帧失败：{(r.stderr or '').strip()[-300:]}")
    files = sorted(out_dir.glob("f_*.jpg"))
    if not files:
        sys.exit("[error] 抽帧结果为空，视频可能损坏或过短。")
    return files


def detect_scene_cuts(video: Path) -> list:
    r = run(["ffmpeg", "-i", str(video), "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',showinfo",
             "-f", "null", "-"], 1800)
    cuts = []
    for line in (r.stderr or "").splitlines():
        if "pts_time:" in line:
            try:
                cuts.append(round(float(line.split("pts_time:")[1].split()[0]), 2))
            except (IndexError, ValueError):
                pass
    return cuts


def build_shots(cuts, duration, min_shot):
    """场景切换点 → 镜头区间 [(start, end), ...]；无切换则整片一个镜头。"""
    bounds = [0.0] + [c for c in cuts if min_shot < c < duration - min_shot] + [duration]
    shots, start = [], bounds[0]
    for b in bounds[1:]:
        if b - start >= min_shot:
            shots.append((round(start, 2), round(b, 2)))
            start = b
    if shots and start < duration:
        shots[-1] = (shots[-1][0], round(duration, 2))
    return shots or [(0.0, round(duration, 2))]


def frames_in_shot(frame_files, fps, start, end, max_n=MAX_KEYFRAMES, last=False):
    """镜头内首 / 1/4 / 中 / 3/4 / 尾关键帧（最多 max_n 张）。

    区间左闭右开（末镜含尾帧），避免剪辑点上的同一帧被前后两个镜头重复取用。
    """
    eps = 1e-6
    idxs = [i for i in range(len(frame_files))
            if start - eps <= i / fps < (end + eps if last else end - eps)]
    if not idxs:
        mid = (start + end) / 2
        idxs = [min(range(len(frame_files)), key=lambda k: abs(k / fps - mid))]
    if len(idxs) > max_n:
        picks = {idxs[0], idxs[len(idxs) // 4], idxs[len(idxs) // 2],
                 idxs[3 * len(idxs) // 4], idxs[-1]}
        idxs = sorted(picks)[:max_n]
    return [(frame_files[i], round(i / fps, 2)) for i in idxs]


def label_for(i):
    return chr(ord("A") + i) if i < 26 else f"S{i + 1}"


def ratio_label(w, h):
    """优先给出常见比例（9:16 / 16:9 / 3:4 / 4:3 / 1:1 / 21:9），否则给宽高比数值。"""
    try:
        ratio = float(w) / float(h)
    except ZeroDivisionError:
        return f"{w}x{h}"
    common = {9 / 16: "9:16", 16 / 9: "16:9", 3 / 4: "3:4", 4 / 3: "4:3",
              1.0: "1:1", 21 / 9: "21:9", 2 / 3: "2:3", 3 / 2: "3:2"}
    for value, label in common.items():
        if abs(ratio - value) / value < 0.02:
            return label
    return f"{ratio:.2f}:1"


def build_manifest(video: Path, fps_mode: str, min_shot: float, force: bool) -> dict:
    need("ffprobe")
    need("ffmpeg")
    sha = sha256_file(video)
    sha16 = sha[:16]
    cache = CACHE_ROOT / sha16
    manifest_path = cache / "manifest.json"

    if manifest_path.is_file() and not force:
        m = json.loads(manifest_path.read_text("utf-8"))
        print(f"[cache] 命中缓存 {manifest_path}（--force 可重建）", flush=True)
        return m

    meta = ffprobe(video)
    duration = meta["duration"]
    if duration <= 0:
        sys.exit("[error] 读不到时长，无法切镜头。")
    fps = 0.5 if (fps_mode == "auto" and duration > 120) else (1.0 if fps_mode == "auto" else float(fps_mode))

    cache.mkdir(parents=True, exist_ok=True)
    print(f"[analyze] {video.name}: {meta['width']}x{meta['height']}, {duration}s, "
          f"{ratio_label(meta['width'], meta['height'])}, fps={fps}", flush=True)

    frames = extract_frames(video, cache / "frames", fps)
    print(f"[frames] 抽到 {len(frames)} 帧 → {cache / 'frames'}", flush=True)

    cuts = detect_scene_cuts(video)
    spans = build_shots(cuts, duration, min_shot)
    print(f"[shots] {len(frames)} 帧, {len(cuts)} 个剪辑点 → {len(spans)} 个镜头", flush=True)

    shots = []
    for i, (start, end) in enumerate(spans):
        kfs = frames_in_shot(frames, fps, start, end, last=(i == len(spans) - 1))
        shots.append({
            "id": label_for(i),
            "start": start,
            "end": round(end, 2),
            "duration": round(end - start, 2),
            "frames": [{"t": t, "path": str(p.relative_to(cache)).replace("\\", "/"),
                        "abs": str(p.resolve())} for p, t in kfs],
        })

    manifest = {
        "video": str(video.resolve()),
        "video_name": video.name,
        "sha256": sha,
        "sha16": sha16,
        "cache_dir": str(cache.resolve()),
        "created": datetime.now().astimezone().isoformat(timespec="seconds"),
        "duration": duration,
        "width": meta["width"],
        "height": meta["height"],
        "ratio": ratio_label(meta["width"], meta["height"]),
        "has_audio": meta["has_audio"],
        "sample_fps": fps,
        "scene_cuts": cuts,
        "min_shot": min_shot,
        "shots": shots,
        "next": [
            "用 read_image 逐镜读 frames（每镜 3-4 张，一次并发读 6-8 张）",
            f"按 references/storyboard-schema.md 写 {cache / 'storyboard.json'}",
            "写提示词包 payload_<style>.json（可先 --scaffold 生成骨架）",
            "跑 python scripts/replicate.py <video> --payload payload_<style>.json --style <style> 校验并渲染",
        ],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    return manifest


def print_report(m: dict):
    print(f"\n视频：{m['video_name']}  {m['duration']}s  {m['width']}x{m['height']}（{m['ratio']}）"
          f"  抽帧 {m['sample_fps']}fps  音轨 {'有' if m.get('has_audio') else '无'}")
    print(f"剪辑点：{m['scene_cuts'] or '无（整片一镜）'}")
    print(f"缓存目录：{m['cache_dir']}")
    print("\n镜头 | 区间 | 时长 | 关键帧（read_image 直接读这些绝对路径）")
    print("-" * 96)
    for s in m["shots"]:
        ts = ", ".join(f"t={f['t']:g}" for f in s["frames"])
        print(f"  {s['id']}  | {s['start']:>5.2f}-{s['end']:>5.2f}s | {s['duration']:>5.2f}s | {ts}")
        for f in s["frames"]:
            print(f"       [{s['id']}] t={f['t']:<5g}s {f['abs']}")
    print("-" * 96)
    print("\n下一步（不调任何模型，你自己看帧）：")
    for i, step in enumerate(m["next"], 1):
        print(f"  {i}. {step}")


def main():
    ap = argparse.ArgumentParser(description="镜头感知准备：ffprobe + 抽帧 + 场景切分 + 关键帧清单（零 API）")
    ap.add_argument("video", type=Path)
    ap.add_argument("--fps", default="auto", help="抽帧密度：auto（≤120s→1fps，更长→0.5fps）或具体数值")
    ap.add_argument("--min-shot", type=float, default=0.8, help="最短镜头秒数，更短的碎片会被合并（默认 0.8）")
    ap.add_argument("--force", action="store_true", help="忽略缓存重建")
    ap.add_argument("--clean", action="store_true", help="删掉这份视频的缓存（帧 + manifest + storyboard）后退出")
    ap.add_argument("--json", action="store_true", help="只输出 manifest JSON（给脚本串联用）")
    args = ap.parse_args()

    video = args.video.expanduser().resolve()
    if not video.is_file():
        sys.exit(f"[error] 找不到视频：{video}")

    if args.clean:
        sha16 = sha256_file(video)[:16]
        target = (CACHE_ROOT / sha16).resolve()
        if target.is_dir() and str(target).startswith(str(CACHE_ROOT.resolve())):
            shutil.rmtree(target)
            print(f"[clean] 已删除 {target}")
        else:
            print("[clean] 没有缓存可删")
        return

    manifest = build_manifest(video, args.fps, args.min_shot, args.force)
    if args.json:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    else:
        print_report(manifest)


if __name__ == "__main__":
    main()
