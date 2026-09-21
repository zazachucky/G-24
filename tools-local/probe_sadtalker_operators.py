"""Small operator/device probes only; never loads or runs the SadTalker model."""
import argparse
import json
import time

import torch
import torch.nn.functional as F

parser = argparse.ArgumentParser()
parser.add_argument("--cpu-bench", action="store_true")
parser.add_argument("--threads", type=int, default=1)
args = parser.parse_args()
if args.cpu_bench:
    torch.set_num_threads(args.threads)
report = {
    "torch": torch.__version__, "cpu_threads": torch.get_num_threads(),
    "cpu_interop_threads": torch.get_num_interop_threads(),
    "mps_built": torch.backends.mps.is_built(),
    "mps_available": torch.backends.mps.is_available(),
    "mps_operators": [], "cpu_microbench": [],
}
print(json.dumps({key: value for key, value in report.items() if not isinstance(value, list)}), flush=True)
if report["mps_available"]:
    x2 = torch.rand(1, 8, 16, 16, device="mps")
    x3 = torch.rand(1, 8, 4, 16, 16, device="mps")
    grid3 = torch.rand(1, 4, 16, 16, 3, device="mps") * 2 - 1
    operations = {
        "conv2d": lambda: torch.nn.Conv2d(8, 8, 3, padding=1).to("mps")(x2),
        "conv3d": lambda: torch.nn.Conv3d(8, 8, 3, padding=1).to("mps")(x3),
        "grid_sample_3d": lambda: F.grid_sample(x3, grid3, align_corners=False),
        "nearest_3d": lambda: F.interpolate(x3, scale_factor=(1, 2, 2)),
        "trilinear_3d": lambda: F.interpolate(x3, scale_factor=(1, 2, 2), mode="trilinear", align_corners=False),
        "instance_norm2d": lambda: F.instance_norm(x2),
    }
    with torch.no_grad():
        for name, operation in operations.items():
            try:
                output = operation()
                output.cpu()  # Force completion; torch 2.0.1 has no public torch.mps namespace.
                item = {"operator": name, "status": "PASS", "shape": list(output.shape)}
            except Exception as exc:
                item = {"operator": name, "status": "FAIL", "error": str(exc)}
            report["mps_operators"].append(item)
            print(json.dumps(item), flush=True)
if args.cpu_bench:
    torch.manual_seed(0)
    cases = {
        "conv2d_256ch_64x64": (torch.nn.Conv2d(256, 256, 3, padding=1).eval(), torch.rand(1, 256, 64, 64)),
        "conv3d_32ch_16x64x64": (torch.nn.Conv3d(32, 32, 3, padding=1).eval(), torch.rand(1, 32, 16, 64, 64)),
    }
    with torch.no_grad():
        for threads in (args.threads,):
            for name, (module, data) in cases.items():
                module(data)
                start = time.perf_counter()
                for _ in range(2):
                    module(data)
                seconds = (time.perf_counter() - start) / 2
                item = {"operator": name, "threads": threads, "seconds_per_call": seconds}
                report["cpu_microbench"].append(item)
                print(json.dumps(item), flush=True)
print("REPORT=" + json.dumps(report), flush=True)
