"""Resume the selected public model manifest with native HF/Xet, two files at a time."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import os
import time

HERE = Path(__file__).resolve().parent
os.environ["HF_HOME"] = str(HERE / "ltx-hf-cache")
os.environ["HF_XET_HIGH_PERFORMANCE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
from huggingface_hub import hf_hub_download

manifest_path = HERE / "ltx-download-manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["status"] = "DOWNLOADING_NATIVE_HF"
items = manifest["files"]
verified = []
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def download(item):
    target = HERE / item["directory"] / item["path"]
    start = time.monotonic()
    if not target.exists() or target.stat().st_size != item["bytes"]:
        print(f"Downloading {item['repo']} / {item['path']} ({item['bytes']/1e9:.3f} GB)", flush=True)
        target = Path(hf_hub_download(
            repo_id=item["repo"], filename=item["path"], revision=item["revision"],
            local_dir=str(HERE / item["directory"]),
        ))
    sha = digest(target)
    if target.stat().st_size != item["bytes"]:
        raise RuntimeError(f"Size mismatch: {target}")
    if item.get("expected_sha256") and sha != item["expected_sha256"]:
        raise RuntimeError(f"SHA256 mismatch: {target}")
    print(f"Verified {item['path']} in {time.monotonic()-start:.1f}s", flush=True)
    return dict(item, sha256=sha, verified=True, local_path=str(target), elapsed_s=time.monotonic()-start)

manifest_path.write_text(json.dumps(manifest, indent=2))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures = [pool.submit(download, item) for item in items]
    for future in concurrent.futures.as_completed(futures):
        verified.append(future.result())
        manifest["completed_files"] = verified
        manifest_path.write_text(json.dumps(manifest, indent=2))

manifest["status"] = "VERIFIED"
manifest["files"] = verified
manifest.pop("completed_files", None)
manifest_path.write_text(json.dumps(manifest, indent=2))
status_path = HERE / "ltx-setup-status.json"
status = json.loads(status_path.read_text())
status["status"] = "ENVIRONMENT_AND_WEIGHTS_READY_INFERENCE_NOT_RUN"
status_path.write_text(json.dumps(status, indent=2))
print("All selected weights downloaded and verified. No inference has run.", flush=True)
