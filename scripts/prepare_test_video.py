#!/usr/bin/env python3
"""Prepare a 120-second product-video timeline from the scene narration audio."""

import argparse
import audioop
import json
from pathlib import Path
import shutil
import subprocess
import textwrap
import wave


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/video/test-live"


def stamp(seconds, separator="."):
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3600000)
    minutes, millis = divmod(millis, 60000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-dir", type=Path, required=True)
    args = parser.parse_args()
    source = json.loads((ROOT / "assets/video/sample-live/storyboard.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "audio").mkdir(exist_ok=True)
    rate = 22050
    timeline = bytearray(120 * rate * 2)
    scenes = []
    subtitles = ["WEBVTT", "", "NOTE Script captions aligned to the inserted narration clips; not ASR output.", ""]
    chapters = ["WEBVTT", ""]
    srt = []
    audio_validation = []
    for index, scene in enumerate(source["scenes"], 1):
        incoming = args.audio_dir / f"{index:02d}.wav"
        target = OUT / "audio" / f"{index:02d}.wav"
        if not incoming.is_file():
            aiff = args.audio_dir / f"{index:02d}.aiff"
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(aiff), str(incoming)], check=True)
        shutil.copyfile(incoming, target)
        with wave.open(str(target), "rb") as audio:
            assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (rate, 1, 2)
            frames = audio.readframes(audio.getnframes())
            seconds = audio.getnframes() / rate
        assert 0 < seconds < 9.3, (scene["id"], seconds)
        rms = audioop.rms(frames, 2)
        assert rms > 100, (scene["id"], "silent narration")
        start = scene["start_s"] + 0.45
        end = start + seconds
        sample_start = round(start * rate) * 2
        timeline[sample_start:sample_start + len(frames)] = frames
        rendered = dict(scene)
        rendered["audio_start_s"] = start
        rendered["audio_end_s"] = round(end, 6)
        rendered["audio_path"] = target.relative_to(ROOT).as_posix()
        rendered["image_labels"] = scene["product_visual"]["image_labels"]
        scenes.append(rendered)
        caption = "\n".join(textwrap.wrap(scene["narration"], width=36))
        subtitles.extend([scene["id"], f"{stamp(start)} --> {stamp(end)}", caption, ""])
        srt.extend([str(index), f"{stamp(start, ',')} --> {stamp(end, ',')}", caption, ""])
        chapters.extend([scene["id"], f"{stamp(scene['start_s'])} --> {stamp(scene['start_s'] + 10)}", scene["title"], ""])
        audio_validation.append({"id": scene["id"], "duration_s": round(seconds, 6), "rms": rms, "peak": audioop.max(frames, 2)})
    assert len(timeline) == 120 * rate * 2
    with wave.open(str(OUT / "narration.wav"), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(timeline)
    plan = {
        "title": "GS AI LIVE · 기능 검증용 상품 설명 영상",
        "width": 1920, "height": 1080, "fps": 24, "duration_s": 120,
        "host_type": "none", "media_type": "product_images_with_synthetic_narration",
        "audio_path": "assets/video/test-live/narration.wav",
        "persistent_label": "기능 검증용 샘플 · 실제 방송 아님",
        "source_snapshot_date": "2026-09-21", "scenes": scenes,
    }
    write_json(OUT / "render-plan.json", plan)
    write_json(OUT / "reference-transcript.json", {
        "provenance": "script_reference_not_asr",
        "timing_basis": "measured audio clips placed at each scene start plus 0.45 seconds",
        "segments": [{"id": s["id"], "start_s": s["audio_start_s"], "end_s": s["audio_end_s"], "text": s["narration"]} for s in scenes],
    })
    write_json(OUT / "audio-verification.json", {"duration_s": 120, "sample_rate": rate, "channel_count": 1, "clips": audio_validation})
    (OUT / "subtitles.ko.vtt").write_text("\n".join(subtitles) + "\n", encoding="utf-8")
    (OUT / "subtitles.ko.srt").write_text("\n".join(srt) + "\n", encoding="utf-8")
    (OUT / "chapters.ko.vtt").write_text("\n".join(chapters) + "\n", encoding="utf-8")
    # A file:// viewer cannot fetch local JSON, so expose the same data as a script.
    (OUT / "timeline.js").write_text("window.GS_TEST_VIDEO = " + json.dumps(plan, ensure_ascii=False).replace("</", "<\\/") + ";\n", encoding="utf-8")
    print(json.dumps({"scenes": len(scenes), "duration_s": 120, "narration_seconds": round(sum(s["duration_s"] for s in audio_validation), 3), "audio_checks": "PASS", "output": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
