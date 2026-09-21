"""Fetch only official SVD-XT fp16 inference files, verifying published SHA256."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parent / "models" / "stable-video-diffusion-img2vid-xt"
REPO = "stabilityai/stable-video-diffusion-img2vid-xt"


def read_json(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.load(response)


def main():
    info = read_json(f"https://huggingface.co/api/models/{REPO}")
    if info.get("gated"):
        raise RuntimeError("Official model requires gated authorization; stopping")
    revision = info["sha"]
    rows = read_json(f"https://huggingface.co/api/models/{REPO}/tree/{revision}?recursive=true&expand=false")
    selected = [x for x in rows if x["path"].endswith((".json", ".fp16.safetensors"))
                or x["path"] in ("README.md", "LICENSE.md")]
    ROOT.mkdir(parents=True, exist_ok=True)

    def download(row):
        path = ROOT / row["path"]
        expected_hash = row.get("lfs", {}).get("oid")
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        if path.exists() and path.stat().st_size == row["size"]:
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
                    digest.update(chunk)
                    size += len(chunk)
            if not expected_hash or digest.hexdigest() == expected_hash:
                print(f"Already verified: {row['path']}", flush=True)
                return {**row, "sha256": digest.hexdigest(), "verified": True}
        digest = hashlib.sha256()
        size = 0
        url = f"https://huggingface.co/{REPO}/resolve/{revision}/{row['path']}"
        partial = path.with_name(path.name + ".part")
        print(f"Downloading: {row['path']} ({row['size']:,} bytes)", flush=True)
        if partial.exists() and partial.stat().st_size < row["size"]:
            with partial.open("rb") as previous:
                for chunk in iter(lambda: previous.read(8 * 1024 * 1024), b""):
                    digest.update(chunk)
                    size += len(chunk)
        headers = {"User-Agent": "GS-AI-LIVE-local-prototype/1.0"}
        if size:
            headers["Range"] = f"bytes={size}-"
        request = urllib.request.Request(url, headers=headers)
        response = urllib.request.urlopen(request, timeout=90)
        if size and response.status != 206:
            # A server may ignore Range; discard the old partial before rewriting.
            size = 0
            digest = hashlib.sha256()
        if size:
            content_range = response.headers.get("Content-Range", "")
            if not content_range.startswith(f"bytes {size}-"):
                response.close()
                raise RuntimeError(f"Unexpected resume range: {content_range}")
            print(f"Resuming: {row['path']} at byte {size:,}", flush=True)
        with response, partial.open("ab" if size else "wb") as output:
            for chunk in iter(lambda: response.read(8 * 1024 * 1024), b""):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if size != row["size"] or (expected_hash and digest.hexdigest() != expected_hash):
            raise RuntimeError(f"Size/hash mismatch: {row['path']}")
        partial.replace(path)
        print(f"Verified: {row['path']} ({size:,} bytes)", flush=True)
        return {**row, "sha256": digest.hexdigest(), "verified": True}

    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(download, selected))
    record = {"repository": REPO, "revision": revision, "gated": False,
              "total_bytes": sum(x["size"] for x in files), "files": files,
              "elapsed_seconds": round(time.monotonic() - started, 2)}
    (ROOT / "download-manifest.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({k: v for k, v in record.items() if k != "files"}), flush=True)


if __name__ == "__main__":
    main()
