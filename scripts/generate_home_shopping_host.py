#!/usr/bin/env python3
"""Render the fictional host in ten-second slots, with resumable local outputs.

Run with tools-local/venv-sadtalker/bin/python after prepare_home_shopping.py.
Source models, caches, audio, images and outputs all remain in this workspace.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import cv2
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/video/home-shopping"


def inspect_video(path, expected_frames):
    video = cv2.VideoCapture(str(path))
    result = {"path": path.relative_to(ROOT).as_posix(), "frames": int(video.get(cv2.CAP_PROP_FRAME_COUNT)),
              "fps": video.get(cv2.CAP_PROP_FPS), "width": int(video.get(cv2.CAP_PROP_FRAME_WIDTH)),
              "height": int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))}
    ok, frame = video.read()
    video.release()
    if not ok or result["frames"] != expected_frames or abs(result["fps"] - 25) > 0.001:
        raise RuntimeError(f"Invalid generated host clip: {result}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner", type=Path, default=ROOT / "tools-local/run_sadtalker_cpu.py")
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.start <= args.end <= 12:
        raise ValueError("Scene range must be within 1..12")
    scenes = OUT / "host-scenes"
    scenes.mkdir(exist_ok=True)
    state_path = OUT / "host-render-status.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"status": "RENDERING", "completed": {}}
    state.pop("error", None)
    source_digest = hashlib.sha256((OUT / "host-source.png").read_bytes()).hexdigest()
    def save():
        state["updated_local"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for index in range(args.start, args.end + 1):
        target = scenes / f"host-{index:02d}.mp4"
        audio = OUT / "audio" / f"slot-{index:02d}.wav"
        inputs = {"source_sha256": source_digest, "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest()}
        if target.exists():
            previous = state["completed"].get(str(index), {})
            if previous.get("inputs") != inputs:
                raise RuntimeError(f"Scene {index} exists but its recorded inputs differ; preserve or move the old clip before regenerating")
            inspect_video(target, 250)
            save()
            continue
        work = scenes / f"work-{index:02d}"
        work.mkdir(exist_ok=True)
        log = scenes / f"scene-{index:02d}.log"
        command = [sys.executable, str(args.runner.resolve()), "--source_image", str(OUT / "host-source.png"),
                   "--driven_audio", str(audio), "--result_dir", str(work), "--size", "256",
                   "--preprocess", "full", "--batch_size", "1"]
        state.update(status="RENDERING", current_scene=index, runner=args.runner.relative_to(ROOT).as_posix())
        save()
        started = time.monotonic()
        print(f"Scene {index:02d}: generating 250 synchronized host frames; log {log.relative_to(ROOT)}", flush=True)
        try:
            with log.open("w") as output:
                subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, check=True)
            results = sorted(work.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
            if not results:
                raise RuntimeError("Renderer returned without a generated MP4")
            raw = results[-1]
            inspect_video(raw, 250)
            temporary = target.with_name(target.stem + ".tmp.mp4")
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                            "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", str(temporary)], check=True)
            check = inspect_video(temporary, 250)
            temporary.replace(target)
            check["path"] = target.relative_to(ROOT).as_posix()
            check["render_seconds"] = round(time.monotonic() - started, 3)
            check["inputs"] = inputs
            state["completed"][str(index)] = check
            save()
            print(f"Scene {index:02d}: complete in {check['render_seconds']} seconds", flush=True)
        except Exception as error:
            state.update(status="FAILED", error=str(error))
            save()
            raise
    if all((scenes / f"host-{i:02d}.mp4").exists() for i in range(1, 13)):
        for i in range(1, 13):
            inspect_video(scenes / f"host-{i:02d}.mp4", 250)
        listing = scenes / "concat.txt"
        listing.write_text("".join(f"file 'host-{i:02d}.mp4'\n" for i in range(1, 13)))
        temporary = OUT / "host-120s.tmp.mp4"
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1",
                        "-i", str(listing), "-an", "-c:v", "copy", "-movflags", "+faststart", str(temporary)], check=True)
        target = OUT / "host-120s.mp4"
        check = inspect_video(temporary, 3000)
        temporary.replace(target)
        check["path"] = target.relative_to(ROOT).as_posix()
        state.update(status="COMPLETE", host_video=check, narration_added_by="final home-shopping compositor")
        save()
        print(json.dumps(state, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
