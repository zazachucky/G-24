"""Prefetch the two pending Gemma shards; never mutate the primary manifest."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import os
import subprocess
import threading
import time

HERE = Path(__file__).resolve().parent
os.environ["HF_HOME"] = str(HERE / "ltx-hf-cache")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_XET_HIGH_PERFORMANCE"] = "1"
os.environ["HF_XET_NUM_CONCURRENT_RANGE_GETS"] = "8"
from huggingface_hub import hf_hub_download

manifest = json.loads((HERE / "ltx-download-manifest.json").read_text())
items = [item for item in manifest["files"] if item["repo"].startswith("mlx-community/") and item["path"].endswith(".safetensors")]
start = time.time()
peak_rss = 0
finished = threading.Event()
status_path = HERE / "ltx-gemma-prefetch.json"

def watcher():
    global peak_rss
    while not finished.wait(2):
        result = subprocess.check_output(["ps", "-axo", "rss,command"], text=True)
        total = 0
        for line in result.splitlines()[1:]:
            rss, _, command = line.strip().partition(" ")
            if command.endswith("tools-local/ltx-download-native.py") or command.endswith("tools-local/ltx-prefetch-gemma.py"):
                total += int(rss) * 1024
        peak_rss = max(peak_rss, total)
        if total > 1.8 * 1024**3:
            status_path.write_text(json.dumps({"status": "PAUSED_FOR_RSS_HEADROOM", "aggregate_rss_bytes": total, "peak_aggregate_rss_bytes": peak_rss, "elapsed_s": time.time()-start}, indent=2))
            print(f"Pausing only extra Gemma prefetch: aggregate downloader RSS {total/1024**3:.2f} GiB exceeds 1.8 GiB headroom guard.", flush=True)
            os._exit(75)

def download(item):
    target = HERE / item["directory"] / item["path"]
    print(f"Prefetching {item['path']} ({item['bytes']/1e9:.3f} GB)", flush=True)
    if not target.exists() or target.stat().st_size != item["bytes"]:
        target = Path(hf_hub_download(item["repo"], item["path"], revision=item["revision"], local_dir=str(target.parent)))
    digest = hashlib.sha256()
    with target.open("rb") as source:
        for block in iter(lambda: source.read(8*1024*1024), b""):
            digest.update(block)
    if target.stat().st_size != item["bytes"] or digest.hexdigest() != item["expected_sha256"]:
        raise RuntimeError(f"Verification failed for {target}")
    print(f"Verified {item['path']}", flush=True)
    return dict(item, sha256=digest.hexdigest(), verified=True, local_path=str(target))

status_path.write_text(json.dumps({"status": "DOWNLOADING_TWO_GEMMA_SHARDS", "start_time": start, "primary_manifest_mutation": False}, indent=2))
threading.Thread(target=watcher, daemon=True).start()
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        verified = list(pool.map(download, items))
    status_path.write_text(json.dumps({"status": "VERIFIED", "files": verified, "peak_aggregate_rss_bytes": peak_rss, "elapsed_s": time.time()-start}, indent=2))
finally:
    finished.set()
