"""Benchmark the loaded renderer on synthetic tensors; no full inference/video.

Each invocation is a fresh process so PyTorch native thread settings take effect.
The optional decoder experiment is in-memory only; official source is untouched.
"""
import argparse
from contextlib import nullcontext
import json
import os
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--threads", type=int, default=1)
parser.add_argument("--decoder-mps", action="store_true")
parser.add_argument("--renderer-mps", action="store_true")
parser.add_argument("--mps-overlay", action="store_true")
parser.add_argument("--precision", choices=["fp32", "fp16", "autocast"], default="fp32")
parser.add_argument("--save-output")
parser.add_argument("--runs", type=int, default=2)
args = parser.parse_args()
if args.mps_overlay:
    sys.path.insert(0, str(Path(__file__).resolve().parent / "mps-packages"))
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch
torch.set_num_threads(args.threads)
torch.set_num_interop_threads(1)
torch.manual_seed(0)

import safetensors.torch
import yaml

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "SadTalker"))
from src.facerender.modules.generator import OcclusionAwareSPADEGenerator
if args.renderer_mps:
    from sadtalker_mps_compat import apply_mps_compat
    apply_mps_compat()

config = yaml.safe_load((ROOT / "SadTalker/src/config/facerender.yaml").read_text())["model_params"]
generator = OcclusionAwareSPADEGenerator(**config["generator_params"], **config["common_params"])
weights = safetensors.torch.load_file(str(ROOT / "SadTalker/checkpoints/SadTalker_V0.0.2_256.safetensors"))
generator.load_state_dict({name[len("generator."):]: value for name, value in weights.items() if name.startswith("generator.")})
del weights
generator.eval()
if args.renderer_mps:
    generator.to("mps")
    if args.precision == "fp16":
        generator.half()
    if args.precision != "fp32":
        # CPU grid_sample does not support half input. Preserve its math in fp32.
        import torch.nn.functional as functional
        original_grid_sample = functional.grid_sample
        def grid_sample_cpu_fp32(input, grid, *positional, **keywords):
            if input.ndim == 5 and input.device.type == "mps":
                result = original_grid_sample(input.float().cpu(), grid.float().cpu(), *positional, **keywords)
                return result.to(device=input.device, dtype=input.dtype)
            return original_grid_sample(input, grid, *positional, **keywords)
        functional.grid_sample = grid_sample_cpu_fp32
        original_avg_pool3d = functional.avg_pool3d
        def avg_pool3d_cpu_fp32(input, *positional, **keywords):
            if input.device.type == "mps" and input.dtype == torch.float16:
                result = original_avg_pool3d(input.float().cpu(), *positional, **keywords)
                return result.to(device=input.device, dtype=input.dtype)
            return original_avg_pool3d(input, *positional, **keywords)
        functional.avg_pool3d = avg_pool3d_cpu_fp32

if args.decoder_mps:
    if not torch.backends.mps.is_available():
        raise RuntimeError("MPS unavailable in this process")
    class DecoderOnMPS(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner.to("mps")
        def forward(self, features):
            return self.inner(features.to("mps")).cpu()
    generator.decoder = DecoderOnMPS(generator.decoder)

timings = {"dense_motion": [], "decoder": []}
starts = {}
def before(name):
    def hook(_module, _input):
        if args.renderer_mps:
            torch.mps.synchronize()
        starts[name] = time.perf_counter()
    return hook
def after(name):
    def hook(_module, _input, _output):
        if args.renderer_mps:
            torch.mps.synchronize()
        timings[name].append(time.perf_counter() - starts[name])
    return hook
for name, module in [("dense_motion", generator.dense_motion_network), ("decoder", generator.decoder)]:
    module.register_forward_pre_hook(before(name))
    module.register_forward_hook(after(name))

device = "mps" if args.renderer_mps else "cpu"
dtype = torch.float16 if args.precision == "fp16" else torch.float32
image = torch.rand(1, 3, 256, 256).to(device=device, dtype=dtype)
source = {"value": (torch.rand(1, 15, 3) * 0.4 - 0.2).to(device=device, dtype=dtype)}
driving = {"value": source["value"] + 0.01}
print(json.dumps({"phase": "ready", "threads_requested": args.threads,
                  "threads_actual": torch.get_num_threads(), "interop_threads": torch.get_num_interop_threads(),
                  "decoder_mps": args.decoder_mps, "renderer_mps": args.renderer_mps, "precision": args.precision}), flush=True)
autocast = torch.autocast("mps", dtype=torch.float16) if args.precision == "autocast" else nullcontext()
with torch.no_grad(), autocast:
    generator(image, kp_driving=driving, kp_source=source)
    timings = {"dense_motion": [], "decoder": []}
    elapsed = []
    for _ in range(args.runs):
        start = time.perf_counter()
        result = generator(image, kp_driving=driving, kp_source=source)
        if args.renderer_mps:
            result["prediction"].cpu()
        elapsed.append(time.perf_counter() - start)
    print(json.dumps({
        "phase": "result", "torch": torch.__version__, "threads": torch.get_num_threads(), "decoder_mps": args.decoder_mps, "renderer_mps": args.renderer_mps,
        "precision": args.precision,
        "frame_seconds": elapsed, "mean_frame_seconds": sum(elapsed) / len(elapsed),
        "component_seconds": timings, "output_shape": list(result["prediction"].shape),
        "output_finite": bool(torch.isfinite(result["prediction"]).all()),
        "scope": "synthetic renderer only; excludes preprocessing/audio2coeff/video encoding; not image quality validation",
    }), flush=True)
    if args.save_output:
        import numpy as np
        np.save(args.save_output, result["prediction"].float().cpu().numpy())
