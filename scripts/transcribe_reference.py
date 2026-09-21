#!/usr/bin/env python3
"""Transcribe the supplied reference MP4 locally; never use product/script prompts.

Run with tools-local/venv-sadtalker/bin/python scripts/transcribe_reference.py.
The output is an unreviewed ASR draft, not a product fact source.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import platform
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools-local/asr-packages"))
os.environ["PATH"] = str(ROOT / "tools-local/bin") + os.pathsep + os.environ.get("PATH", "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["tiny", "base", "small"], default="base")
    args = parser.parse_args()
    import torch
    import whisper

    source = ROOT / "assets/video/reference/core-authentic-cardigan.mp4"
    model_dir = ROOT / "tools-local/models/whisper"
    torch.set_num_threads(6)
    started = time.monotonic()
    print("Loading local Whisper model:", args.model, flush=True)
    model = whisper.load_model(args.model, device="cpu", download_root=str(model_dir))
    print("Transcribing actual MP4 audio without a script or initial prompt", flush=True)
    result = model.transcribe(str(source), language="ko", task="transcribe", fp16=False,
                              temperature=0, beam_size=5, condition_on_previous_text=False,
                              verbose=True)
    result["provenance"] = "local_asr_draft_not_manually_audio_verified"
    result["validation"] = "DRAFT_DO_NOT_GROUND_UNREVIEWED_PRODUCT_FACTS"
    result["source_asset_id"] = "reference-core-authentic-cardigan-01"
    result["source_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    result["engine"] = {"name": "openai-whisper", "version": whisper.__version__,
                        "model": args.model, "device": "cpu", "torch": torch.__version__,
                        "platform": platform.machine(), "language": "ko", "fp16": False,
                        "temperature": 0, "beam_size": 5, "initial_prompt": None,
                        "condition_on_previous_text": False, "external_audio_upload": False,
                        "documentation": "https://github.com/openai/whisper"}
    result["engine"]["model_sha256"] = hashlib.sha256((model_dir / (args.model + ".pt")).read_bytes()).hexdigest()
    result["created_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    output = source.parent / ("transcript-asr-" + args.model + ".json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Saved", output, flush=True)


if __name__ == "__main__":
    main()
