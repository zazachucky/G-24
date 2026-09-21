#!/usr/bin/env python3
"""Synthesize or assemble the fictional host's measured 120-second narration."""

import argparse
import audioop
import json
from pathlib import Path
import subprocess
import textwrap
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/video/home-shopping"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stamp(seconds, separator="."):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{milliseconds:03d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthesize", action="store_true")
    args = parser.parse_args()
    source = json.loads((OUT / "storyboard.json").read_text())
    audio_dir = OUT / "audio"
    audio_dir.mkdir(exist_ok=True)
    if args.synthesize:
        for i, scene in enumerate(source["scenes"], 1):
            text = audio_dir / f"{i:02d}.txt"
            aiff = audio_dir / f"{i:02d}.aiff"
            wav = audio_dir / f"{i:02d}.wav"
            text.write_text(scene["narration_spoken"], encoding="utf-8")
            subprocess.run(["say", "-v", "Yuna", "-r", "175", "-f", str(text), "-o", str(aiff)], check=True)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(aiff), str(wav)], check=True)
            print(f"Synthesized scene {i:02d}", flush=True)
    rate = 22050
    timeline = bytearray(source["duration_s"] * rate * 2)
    scenes, checks = [], []
    subtitles = ["WEBVTT", "", "NOTE Script captions aligned to measured audio; not ASR output.", ""]
    chapters, srt = ["WEBVTT", ""], []
    for i, scene in enumerate(source["scenes"], 1):
        path = audio_dir / f"{i:02d}.wav"
        with wave.open(str(path), "rb") as audio:
            if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (rate, 1, 2):
                raise ValueError(f"Unexpected audio format: {path}")
            frames = audio.readframes(audio.getnframes())
            duration = audio.getnframes() / rate
        if not 0 < duration <= 9.05 or audioop.rms(frames, 2) < 100:
            raise ValueError(f"Scene {i} narration must be audible and fit before 9.5s: {duration:.3f}s")
        start = scene["start_s"] + 0.45
        end = start + duration
        offset = round(start * rate) * 2
        timeline[offset:offset + len(frames)] = frames
        rendered = dict(scene, audio_start_s=start, audio_end_s=round(end, 6),
                        measured_speech_duration_s=duration, audio_path=path.relative_to(ROOT).as_posix())
        scenes.append(rendered)
        checks.append({"scene": scene["id"], "duration_s": duration, "rms": audioop.rms(frames, 2), "peak": audioop.max(frames, 2)})
        caption = "\n".join(textwrap.wrap(scene["narration"], width=36))
        subtitles.extend([scene["id"], f"{stamp(start)} --> {stamp(end)}", caption, ""])
        srt.extend([str(i), f"{stamp(start, ',')} --> {stamp(end, ',')}", caption, ""])
        chapters.extend([scene["id"], f"{stamp(scene['start_s'])} --> {stamp(scene['start_s'] + scene['duration_s'])}", scene["title"], ""])
    def save_wav(path, data):
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(data)
    save_wav(OUT / "narration.wav", timeline)
    for i, scene in enumerate(scenes, 1):
        start = round(scene["start_s"] * rate) * 2
        end = start + round(scene["duration_s"] * rate) * 2
        save_wav(audio_dir / f"slot-{i:02d}.wav", timeline[start:end])
    plan = {"title": source["title"], "width": 1920, "height": 1080, "fps": 25, "duration_s": 120,
            "host_type": "photorealistic_fictional_talking_host", "audio_path": "assets/video/home-shopping/narration.wav",
            "host_video_path": "assets/video/home-shopping/host-120s.mp4",
            "persistent_label": "AI 가상 쇼호스트 · 데모 방송", "source_snapshot_date": source["source_snapshot_date"],
            "scenes": scenes}
    write_json(OUT / "render-plan.json", plan)
    write_json(OUT / "audio-verification.json", {"status": "PASS", "duration_s": 120, "sample_rate": rate,
               "voice": "macOS Yuna, 175 words per minute", "clips": checks})
    write_json(OUT / "reference-transcript.json", {"provenance": "script_reference_not_asr",
               "timing_basis": "measured clips inserted 0.45 seconds after each scene start",
               "segments": [{"id": s["id"], "start_s": s["audio_start_s"], "end_s": s["audio_end_s"], "text": s["narration"]} for s in scenes]})
    for path, lines in [("subtitles.ko.vtt", subtitles), ("subtitles.ko.srt", srt), ("chapters.ko.vtt", chapters)]:
        (OUT / path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "timeline.js").write_text("window.GS_HOME_VIDEO = " + json.dumps(plan, ensure_ascii=False).replace("</", "<\\/") + ";\n", encoding="utf-8")
    print(json.dumps({"scenes": len(scenes), "duration_s": 120, "max_clip_s": max(c["duration_s"] for c in checks), "audio_checks": "PASS"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
