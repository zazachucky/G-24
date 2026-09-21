"""Download a pinned, minimal, public LTX I2V pack; verify published LFS hashes."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import threading
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent
LOCK = threading.Lock()
REPOS = {
    "dgrauet/ltx-2.3-mlx-q4": {
        "revision": "56a5866d638ecfe37c54d348e88938235185c2d4",
        "directory": "ltx-model-q4",
        "files": {
            "config.json", "embedded_config.json", "quantize_config.json", "split_model.json",
            "README.md", "LICENSE", "transformer-distilled-1.1.safetensors",
            "connector.safetensors", "vae_encoder.safetensors", "vae_decoder.safetensors",
            "audio_vae.safetensors", "vocoder.safetensors",
            "spatial_upscaler_x2_v1_1.safetensors", "spatial_upscaler_x2_v1_1_config.json",
        },
    },
    "mlx-community/gemma-3-12b-it-4bit": {
        "revision": "86cc6a8dedbc456dd0e4af01a9d09f396f77e558",
        "directory": "ltx-gemma-q4",
        "files": None,
    },
}

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def log(message):
    with LOCK:
        print(message, flush=True)

def download(item):
    path = ROOT / item["directory"] / item["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    expected = item.get("expected_sha256")
    if path.exists() and path.stat().st_size == item["bytes"]:
        digest = sha256(path)
        if expected is None or digest == expected:
            return dict(item, sha256=digest, verified=True, local_path=str(path))
    partial = path.with_name(path.name + ".part")
    if item["bytes"] >= 250_000_000:
        return download_ranges(item, path, partial)
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    request = urllib.request.Request(item["url"], headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        if offset and response.status != 206:
            offset = 0
        last_log = time.monotonic()
        with partial.open("ab" if offset else "wb") as output:
            for block in iter(lambda: response.read(8 * 1024 * 1024), b""):
                output.write(block)
                offset += len(block)
                if time.monotonic() - last_log > 30:
                    log(f"{item['path']}: {offset / 1e9:.2f}/{item['bytes'] / 1e9:.2f} GB")
                    last_log = time.monotonic()
    if partial.stat().st_size != item["bytes"]:
        raise RuntimeError(f"Size mismatch: {partial}")
    digest = sha256(partial)
    if expected and digest != expected:
        raise RuntimeError(f"SHA256 mismatch: {partial}")
    partial.replace(path)
    log(f"Verified {item['path']} ({item['bytes'] / 1e9:.3f} GB)")
    return dict(item, sha256=digest, verified=True, local_path=str(path))

def download_ranges(item, path, partial):
    """Use four ordinary public HTTP Range requests, with per-range resumption."""
    chunk_size = (item["bytes"] + 3) // 4
    chunk_dir = path.with_name(path.name + ".chunks")
    chunk_dir.mkdir(exist_ok=True)
    # Preserve bytes fetched before switching from the original sequential downloader.
    if partial.exists():
        source_size = partial.stat().st_size
        with partial.open("rb") as source:
            for number in range(4):
                start = number * chunk_size
                count = min(chunk_size, max(0, source_size - start))
                destination = chunk_dir / str(number)
                if count and not destination.exists():
                    source.seek(start)
                    with destination.open("wb") as out:
                        while count:
                            block = source.read(min(count, 8 * 1024 * 1024))
                            out.write(block)
                            count -= len(block)
    def one_range(number):
        first = number * chunk_size
        last = min(item["bytes"], first + chunk_size) - 1
        destination = chunk_dir / str(number)
        needed = last - first + 1
        for attempt in range(6):
            offset = destination.stat().st_size if destination.exists() else 0
            if offset == needed:
                return destination
            request = urllib.request.Request(item["url"], headers={"Range": f"bytes={first+offset}-{last}"})
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    expected_range = f"bytes {first+offset}-{last}/{item['bytes']}"
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                        raise RuntimeError(f"Unexpected range response: {response.status} {response.headers.get('Content-Range')}")
                    last_log = time.monotonic()
                    with destination.open("ab") as output:
                        for block in iter(lambda: response.read(8 * 1024 * 1024), b""):
                            output.write(block)
                            offset += len(block)
                            if time.monotonic() - last_log > 30:
                                log(f"{item['path']} chunk {number+1}/4: {offset / 1e9:.2f}/{needed / 1e9:.2f} GB")
                                last_log = time.monotonic()
                if destination.stat().st_size != needed:
                    raise OSError("Incomplete range")
                return destination
            except urllib.error.HTTPError as exc:
                if exc.code not in {429, 500, 502, 503, 504}:
                    raise
                delay = max(int(exc.headers.get("Retry-After", "0")), 15 * (2 ** attempt))
                log(f"HTTP {exc.code}; backing off {delay}s")
                time.sleep(delay)
            except (OSError, TimeoutError) as exc:
                if attempt == 5:
                    raise
                delay = 10 * (2 ** attempt)
                log(f"Network interruption {type(exc).__name__}; resuming after {delay}s")
                time.sleep(delay)
        raise RuntimeError(f"Download retries exhausted: {item['path']}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        chunks = list(pool.map(one_range, range(4)))
    digest = hashlib.sha256()
    with partial.open("wb") as output:
        for chunk in chunks:
            with chunk.open("rb") as source:
                for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                    output.write(block)
                    digest.update(block)
    assert partial.stat().st_size == item["bytes"]
    actual = digest.hexdigest()
    if item.get("expected_sha256") and actual != item["expected_sha256"]:
        raise RuntimeError(f"SHA256 mismatch: {partial}")
    partial.replace(path)
    for chunk in chunks:
        chunk.unlink()
    chunk_dir.rmdir()
    log(f"Verified {item['path']} ({item['bytes'] / 1e9:.3f} GB)")
    return dict(item, sha256=actual, verified=True, local_path=str(path))

items = []
for repo, spec in REPOS.items():
    url = f"https://huggingface.co/api/models/{repo}/tree/{spec['revision']}?recursive=true&expand=false"
    with urllib.request.urlopen(url, timeout=60) as response:
        files = json.load(response)
    for item in files:
        if item["type"] != "file" or item["path"] == ".gitattributes":
            continue
        if spec["files"] is not None and item["path"] not in spec["files"]:
            continue
        items.append({
            "repo": repo, "revision": spec["revision"], "path": item["path"],
            "directory": spec["directory"], "bytes": item["size"],
            "expected_sha256": item.get("lfs", {}).get("oid"),
            "url": f"https://huggingface.co/{repo}/resolve/{spec['revision']}/{item['path']}",
        })

manifest = ROOT / "ltx-download-manifest.json"
manifest.write_text(json.dumps({"status": "DOWNLOADING", "total_bytes": sum(i["bytes"] for i in items), "files": items}, indent=2))
log(f"Downloading {len(items)} files; total {sum(i['bytes'] for i in items) / 1e9:.3f} GB; 4 Range connections per large file")
verified = []
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    pending = {pool.submit(download, item): item for item in items}
    for future in concurrent.futures.as_completed(pending):
        verified.append(future.result())
        manifest.write_text(json.dumps({"status": "DOWNLOADING", "total_bytes": sum(i["bytes"] for i in items), "completed_files": verified, "files": items}, indent=2))
manifest.write_text(json.dumps({"status": "VERIFIED", "total_bytes": sum(i["bytes"] for i in items), "files": verified}, indent=2))
log("All minimal model files downloaded and verified.")
