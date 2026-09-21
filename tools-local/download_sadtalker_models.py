"""Fetch official SadTalker 256 inference weights for crop/full, into the workspace."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent / "SadTalker"
FILES = [
    ("checkpoints/SadTalker_V0.0.2_256.safetensors", "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/SadTalker_V0.0.2_256.safetensors"),
    ("checkpoints/mapping_00229-model.pth.tar", "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00229-model.pth.tar"),
    ("checkpoints/mapping_00109-model.pth.tar", "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00109-model.pth.tar"),
    ("gfpgan/weights/alignment_WFLW_4HG.pth", "https://github.com/xinntao/facexlib/releases/download/v0.1.0/alignment_WFLW_4HG.pth"),
    ("gfpgan/weights/detection_Resnet50_Final.pth", "https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth"),
]
records = []
for relative, url in FILES:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix(target.suffix + ".download")
        print("Downloading " + relative, flush=True)
        with urllib.request.urlopen(url, timeout=90) as response, temporary.open("wb") as output:
            expected = response.headers.get("Content-Length")
            copied = 0
            while True:
                chunk = response.read(4 * 1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                copied += len(chunk)
        if expected is not None and copied != int(expected):
            raise RuntimeError("Incomplete download: " + relative)
        temporary.replace(target)
    digest = hashlib.sha256()
    with target.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    record = {"file": relative, "source": url, "bytes": target.stat().st_size, "sha256_observed": digest.hexdigest()}
    records.append(record)
    print(json.dumps(record), flush=True)
(ROOT.parent / "sadtalker-model-manifest.json").write_text(json.dumps(records, indent=2) + "\n")
