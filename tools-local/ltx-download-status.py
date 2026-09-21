"""Print selected model download progress without loading an ML model."""
from pathlib import Path
import json
import time

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE / "ltx-download-manifest.json").read_text())
start = json.loads((HERE / "ltx-speed-start.json").read_text())
roots = [HERE / "ltx-model-q4", HERE / "ltx-gemma-q4"]
all_files = [p for root in roots if root.exists() for p in root.rglob("*") if p.is_file()]
allocated_bytes = sum(p.stat().st_blocks * 512 for p in all_files)
elapsed = time.time() - start["time"]
bytes_per_second = (allocated_bytes - start["disk_bytes"]) / elapsed
complete = []
partial = []
for item in manifest["files"]:
    target = HERE / item["directory"] / item["path"]
    if target.is_file() and target.stat().st_size == item["bytes"]:
        complete.append(item)
        continue
    digest = item.get("expected_sha256")
    if digest:
        directory = target.parent / ".cache/huggingface/download"
        for unfinished in directory.glob(f"*.{digest}.incomplete"):
            partial.append({"file": item["path"], "bytes": unfinished.stat().st_size, "total_bytes": item["bytes"]})
remaining = manifest["total_bytes"] - sum(i["bytes"] for i in complete) - sum(i["bytes"] for i in partial)
report = {
    "status": manifest["status"], "elapsed_s": round(elapsed, 1),
    "aggregate_MBps": round(bytes_per_second / 1e6, 3),
    "aggregate_Mbps": round(bytes_per_second * 8 / 1e6, 3),
    "completed_files": len(complete), "remaining_files": len(manifest["files"]) - len(complete),
    "completed_bytes": sum(i["bytes"] for i in complete), "partials": partial,
    "remaining_bytes": remaining,
    "estimated_remaining_minutes": round(remaining / bytes_per_second / 60, 1) if bytes_per_second > 0 else None,
    "inference_executed_by_setup_task": False,
}
(HERE / "ltx-ten-minute-progress.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
