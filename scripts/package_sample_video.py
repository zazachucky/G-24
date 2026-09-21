#!/usr/bin/env python3
"""Build the external video production kit; no video or audio is generated."""

import hashlib
import json
from pathlib import Path
import textwrap
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VIDEO = ROOT / "assets/video/sample-live"


def timestamp(seconds, separator="."):
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}{separator}{milliseconds:03}"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(name, value):
    (VIDEO / name).write_text(value, encoding="utf-8")


def main():
    storyboard = read_json(VIDEO / "storyboard.json")
    scenes = storyboard["scenes"]
    assert storyboard["completed_video"] is False
    assert storyboard["timing_status"] == "PLANNED_NOT_MEASURED"
    assert len(scenes) == storyboard["scene_count"] == 12
    cursor = 0
    for scene in scenes:
        assert scene["start_s"] == cursor, scene["id"]
        cursor += scene["duration_s"]
        assert scene["host_delivery"] and scene["product_visual"]
        assert len(scene["images"]) == len(scene["product_visual"]["image_labels"])
        for image_path in scene["images"]:
            assert (ROOT / image_path).is_file(), image_path
        for reference in scene["source_refs"]:
            filename, pointer = reference.split("#", 1)
            value = read_json(ROOT / filename)
            for raw_key in pointer.lstrip("/").split("/"):
                key = raw_key.replace("~1", "/").replace("~0", "~")
                value = value[int(key)] if isinstance(value, list) else value[key]
    assert cursor == storyboard["duration_s"] == 120

    brief = (ROOT / "docs/sample-video-production-brief.md").read_text(encoding="utf-8")
    common_prompt = brief.split("```text\n", 1)[1].split("```", 1)[0].strip()
    prompts = [
        "# 외부 영상 도구용 장면별 제작 지시",
        "", "상태: 제작 준비본. 모든 시각은 계획값이며 완성 영상·음성은 아직 없습니다.",
        "", "## 공통 지시 — 모든 장면에 적용", "", "```text", common_prompt, "```", "",
        "아래 파일 경로는 ZIP 최상위 폴더 기준입니다. 상품 이미지와 코디 예시는 자료 삽입용이며 호스트 참조 얼굴이 아닙니다.",
        "이미지별 글자는 편집 도구의 텍스트 레이어로 넣습니다. 장면별 음성에는 내레이션만 입력합니다.", "",
    ]
    narration = []
    srt = []
    vtt = ["WEBVTT", "", "NOTE PLANNED_NOT_MEASURED: Retiming against rendered audio is required.", ""]
    chapters = ["WEBVTT", "", "NOTE PLANNED_NOT_MEASURED: Chapter boundaries are editorial estimates.", ""]
    for index, scene in enumerate(scenes, 1):
        start = scene["start_s"]
        end = start + scene["duration_s"]
        visual = scene["product_visual"]
        narration.append(scene["narration"])
        caption = "\n".join(textwrap.wrap(scene["narration"], width=36))
        srt.extend([str(index), f"{timestamp(start, ',')} --> {timestamp(end, ',')}", caption, ""])
        vtt.extend([scene["id"], f"{timestamp(start)} --> {timestamp(end)}", caption, ""])
        chapters.extend([scene["id"], f"{timestamp(start)} --> {timestamp(end)}", scene["title"], ""])
        prompts.extend([
            f"## {scene['id']} · {scene['title']}", "",
            f"계획 구간: {timestamp(start)}–{timestamp(end)} / 실제 발화 후 조정", "",
            "### 음성 도구 입력", "", "```text", scene["narration"], "```", "",
            "### 호스트 영상 지시", "", scene["host_delivery"], "",
            "### 편집 지시", "",
            f"- 자료 배치: {visual['layout']}",
            f"- 이미지 표시 방식: `{visual['fit']}`. 원본 비율을 유지합니다.",
            f"- 상단 문구: {scene['kicker']}",
            f"- 화면 제목: {scene['title']}",
            f"- 정보 카드: {' / '.join(scene['caption_lines'])}",
            f"- 장면 표시: {scene['label']}",
            f"- 상시 표시: {' · '.join(storyboard['always_visible_labels'])}",
        ])
        if visual.get("crop_note"):
            prompts.append(f"- 확대 지시: {visual['crop_note']}")
        callouts = list(visual.get("required_callouts", []))
        if visual.get("required_callout"):
            callouts.append(visual["required_callout"])
        for callout in callouts:
            prompts.append(f"- 필수 강조: {callout}")
        prompts.extend(["", "| 순서 | 삽입 파일 | 이미지별 표시 |", "| --- | --- | --- |"])
        for position in visual["image_order"]:
            prompts.append(f"| {position + 1} | `{scene['images'][position]}` | {visual['image_labels'][position]} |")
        prompts.extend(["", "근거: " + "; ".join(f"`{ref}`" for ref in scene["source_refs"]), ""])

    write("scene-prompts.md", "\n".join(prompts) + "\n")
    write("narration.txt", "\n\n".join(narration) + "\n")
    write("planned-subtitles.srt", "\n".join(srt) + "\n")
    write("planned-subtitles.vtt", "\n".join(vtt) + "\n")
    write("planned-chapters.vtt", "\n".join(chapters) + "\n")
    write("README.md", """# GS AI LIVE 쇼호스트 영상 제작 자료

2분·16:9·한국어, 움직이며 말하는 가상 성인 쇼호스트 1명과 실제 상품 자료를 함께 보여주는 제작안입니다.
이 패키지에는 최종 MP4, 호스트 영상, 음성 파일이 없습니다. 대본·편집 자료만 준비한 상태입니다.

1. `docs/sample-video-production-brief.md`의 공통 지시와 납품 기준을 확인합니다.
2. `assets/video/sample-live/scene-prompts.md`에서 장면별 대사와 동작 지시를 복사합니다.
3. 영상 도구에서 사용할 수 있는 가상 성인 호스트와 한국어 목소리를 한 번 선택하고 전 장면에 유지합니다. 먼저 1개 장면의 발화·입모양·동작을 확인합니다.
4. 호스트 영상을 제작한 뒤 장면별 표에 지정된 실제 상품·코디 이미지를 편집 도구에서 삽입합니다. ZIP의 폴더 구조를 유지하면 경로를 그대로 찾을 수 있습니다.
5. 자막 초안과 챕터를 실제 음성·컷에 맞추고 제작 지시서의 항목을 검수합니다.

`narration.txt`는 제목·타임코드 없는 전체 음성 입력용 대본입니다. 12개 문단이 각 장면에 대응합니다.
`planned-subtitles.srt`와 `planned-subtitles.vtt`는 대사 자막 초안입니다. 가격·소재 등 화면 정보 카드는 별도로 삽입합니다.
`planned-chapters.vtt`는 장면 제목 초안입니다. `planned-*`의 10초 간격은 계획값이며 실제 음성과 동기화된 결과가 아닙니다.
`storyboard.json`은 장면별 이미지·근거 데이터·동작을 담은 구조화 자료입니다.

최종 납품: 1920×1080, 16:9, 30fps, H.264 MP4/AAC 음성, 실제 영상과 동기화된 한국어 SRT/VTT와 최종 챕터 목록.
전체 길이는 120초를 목표로 합니다. 숫자 발음과 자연스러운 말 속도를 먼저 확인하고 컷을 조정합니다.
실제 상품 값은 2026.09.21 확인 자료이며, 혜택·배송은 표시된 데모 예시입니다.
이미지·출처 데이터는 `assets/`와 `fixtures/`에 있습니다. `production-manifest.json`은 전달 파일의 SHA-256과 준비 상태를 기록합니다.
완성 영상 검수 전까지 기존 앱의 이미지 기반 데모 설정과 Video AI 미연결 상태를 유지합니다.
""")

    relative_paths = {
        "docs/sample-video-plan.md", "docs/sample-video-production-brief.md",
        "docs/product-data-sources.md", "docs/styling-sources.md",
        "fixtures/main-product.json", "fixtures/demo-config.json",
        "fixtures/styling-looks.json", "fixtures/styling-candidates.json",
        "assets/lookbooks/generation.json",
    }
    for folder in ["assets/products/main", "assets/products/styling", "assets/lookbooks"]:
        for path in (ROOT / folder).iterdir():
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                relative_paths.add(path.relative_to(ROOT).as_posix())
    for name in ["storyboard.json", "scene-prompts.md", "narration.txt", "planned-subtitles.srt", "planned-subtitles.vtt", "planned-chapters.vtt", "README.md"]:
        relative_paths.add((VIDEO / name).relative_to(ROOT).as_posix())
    entries = []
    for name in sorted(relative_paths):
        data = (ROOT / name).read_bytes()
        entries.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest = {
        "status": "PREPRODUCTION_SCRIPT", "completed_video": False,
        "audio_generated": False, "timing_status": "PLANNED_NOT_MEASURED",
        "target_duration_s": 120, "scene_count": len(scenes),
        "validation": {"planned_timeline": "PASS", "source_pointers": "PASS", "image_paths": "PASS", "rendered_video": "NOT_RUN", "audio_subtitle_sync": "NOT_RUN"},
        "files": entries,
    }
    write("production-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    archive = ROOT / "deliverables/gs-ai-live-sample-video-production-kit.zip"
    archive.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(relative_paths):
            bundle.write(ROOT / name, name)
        bundle.write(VIDEO / "README.md", "START-HERE.md")
        bundle.write(VIDEO / "production-manifest.json", "production-manifest.json")
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        for entry in entries:
            assert hashlib.sha256(bundle.read(entry["path"])).hexdigest() == entry["sha256"]
    print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "files": len(entries) + 2, "validation": manifest["validation"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
