#!/usr/bin/env python3
"""Prepare the measured voice-over for the initial three-shot motion review."""

import json
from pathlib import Path
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/video/full-body"
SCENES = [
    ("TRYON", "tryon", "오늘의 캐시미어 풀오버",
     ["SJ와니 샤이니 크리즈", "캐시미어 풀오버"],
     "오늘 소개할 상품은 에스제이와니 캐시미어 풀오버예요. 차분한 그레이 코디를 만나보세요."),
    ("DETAIL", "detail", "소재를 가까이",
     ["캐시미어 85%", "나일론 10% · 폴리에스터 5%"],
     "상품 안내 기준, 캐시미어 팔십오 퍼센트에 나일론과 폴리에스터를 더한 소재예요."),
    ("STYLING", "styling", "그레이와 아이보리의 조합",
     ["아이보리 팬츠 + 블랙 로퍼", "AI 코디 예시"],
     "아이보리 팬츠와 검정 로퍼를 더한 코디 예시예요. 하의와 신발은 별도 상품입니다."),
]


def timestamp(seconds, separator="."):
    milliseconds = round(seconds * 1000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"00:{minutes:02d}:{seconds:02d}{separator}{milliseconds:03d}"


def main():
    audio_dir = OUT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    brief = json.loads((OUT / "production-brief.json").read_text())
    for shot in brief["shots"]:
        (OUT / (shot["id"].lower() + "-prompt.txt")).write_text(shot["prompt"] + "\n")
    scenes = []
    for index, (sid, name, title, captions, narration) in enumerate(SCENES):
        text_path = audio_dir / (name + ".txt")
        aiff_path = audio_dir / (name + ".aiff")
        wav_path = audio_dir / (name + ".wav")
        text_path.write_text(narration + "\n", encoding="utf-8")
        subprocess.run(["say", "-v", "Yuna", "-r", "175", "-f", str(text_path), "-o", str(aiff_path)], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", str(aiff_path), str(wav_path)], check=True)
        with wave.open(str(wav_path), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
        if not 0 < duration <= 7.35:
            raise ValueError(f"Narration {sid} does not fit its 8s slot: {duration:.3f}s")
        start = index * 8
        scenes.append({
            "id": sid, "start_s": start, "duration_s": 8,
            "video_path": f"assets/video/full-body/{name}-approved.mp4",
            "source_start_s": 0, "playback_rate": 0.5,
            "title": title, "caption_lines": captions,
            "narration": narration,
            "audio_path": wav_path.relative_to(ROOT).as_posix(),
            "audio_start_s": start + 0.3,
            "audio_end_s": round(start + 0.3 + duration, 6),
            "measured_speech_duration_s": duration,
        })
    plan = {
        "schema_version": "1.0", "status": "WAITING_FOR_VISUALLY_APPROVED_VIDEO_CLIPS",
        "completed_video": False, "is_full_120_second_demo": False,
        "title": "GS AI LIVE · 착용·소재·전신 동작 검수본",
        "width": 720, "height": 1280, "fps": 24, "duration_s": 24,
        "persistent_label": "AI 가상인물 · 데모", "source_snapshot_date": "2026-09-21",
        "narration_mode": "voice_over", "lip_sync_verified": False,
        "scenes": scenes,
    }
    (OUT / "review-render-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    subtitles = ["WEBVTT", "", "NOTE Voice-over script timing; not ASR output.", ""]
    srt = []
    for index, scene in enumerate(scenes, 1):
        subtitles += [scene["id"], f"{timestamp(scene['audio_start_s'])} --> {timestamp(scene['audio_end_s'])}", scene["narration"], ""]
        srt += [str(index), f"{timestamp(scene['audio_start_s'], ',')} --> {timestamp(scene['audio_end_s'], ',')}", scene["narration"], ""]
    (OUT / "review-subtitles.ko.vtt").write_text("\n".join(subtitles) + "\n")
    (OUT / "review-subtitles.ko.srt").write_text("\n".join(srt) + "\n")
    (OUT / "review-timeline.js").write_text("window.GS_PORTRAIT_REVIEW = " + json.dumps(plan, ensure_ascii=False).replace("</", "<\\/") + ";\n")
    print(json.dumps({"status": "NARRATION_READY_VIDEO_PENDING", "scenes": len(scenes),
                      "clip_durations": [s["measured_speech_duration_s"] for s in scenes]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
