"""Find the first non-finite UNet module boundary in a tiny real-input SVD run.

This is deliberately slow instrumentation. Run only when other MPS jobs stop.
It produces diagnostic JSON, not a deliverable video, and does not alter packages.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "i2v-packages"), str(ROOT / "mps-packages")]
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


class FoundNonFinite(RuntimeError):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--width", type=int, default=128)
    parser.add_argument("--height", type=int, default=224)
    parser.add_argument("--frames", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--attention-upcast-layer", action="append", default=[])
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Report path already exists")
    if args.width % 8 or args.height % 8:
        parser.error("Dimensions must be divisible by 8")

    import torch
    from diffusers import StableVideoDiffusionPipeline
    from PIL import Image, ImageOps

    if not torch.backends.mps.is_available():
        raise RuntimeError("MPS is required for reproducing this diagnostic")
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    started = time.monotonic()
    record = {"status": "RUNNING", "dtype": "float16", "device": "mps",
              "width": args.width, "height": args.height, "frames": args.frames,
              "steps": 1, "module_tensor_checks": 0,
              "scope": "module boundaries; functional operations between modules may need a follow-up probe"}
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        str(ROOT / "models" / "stable-video-diffusion-img2vid-xt"),
        torch_dtype=torch.float16, variant="fp16", use_safetensors=True,
        local_files_only=True, low_cpu_mem_usage=True,
    ).to(device="mps", dtype=torch.float16)
    pipe.unet.enable_forward_chunking(chunk_size=1, dim=0)
    if args.attention_upcast_layer:
        from svd_attention_memory import install_attention_score_upcast
        record["attention_upcast_layers"] = install_attention_score_upcast(pipe.unet, args.attention_upcast_layer)

    def tensors(value, path="value"):
        if isinstance(value, torch.Tensor):
            yield path, value
        elif isinstance(value, dict):
            for key, item in value.items():
                yield from tensors(item, f"{path}.{key}")
        elif isinstance(value, (list, tuple)):
            for index, item in enumerate(value):
                yield from tensors(item, f"{path}[{index}]")

    def check(name, module, stage, value):
        for tensor_path, tensor in tensors(value):
            if not tensor.is_floating_point() or tensor.numel() == 0:
                continue
            record["module_tensor_checks"] += 1
            if bool(torch.isfinite(tensor).all().item()):
                continue
            cpu = tensor.detach().float().cpu()
            finite = cpu[torch.isfinite(cpu)]
            record.update({"status": "FIRST_NONFINITE_MODULE_BOUNDARY_FOUND",
                           "module": name, "module_type": type(module).__name__, "stage": stage,
                           "tensor": tensor_path, "shape": list(tensor.shape), "tensor_dtype": str(tensor.dtype),
                           "nan_count": int(torch.isnan(cpu).sum()), "inf_count": int(torch.isinf(cpu).sum()),
                           "finite_min": float(finite.min()) if finite.numel() else None,
                           "finite_max": float(finite.max()) if finite.numel() else None})
            raise FoundNonFinite(f"{name} {stage} {tensor_path}")

    handles = []
    for name, module in pipe.unet.named_modules():
        def before(current, positional, keywords, _name=name):
            check(_name, current, "input", (positional, keywords))
        def after(current, positional, keywords, output, _name=name):
            check(_name, current, "output", output)
        handles.append(module.register_forward_pre_hook(before, with_kwargs=True))
        handles.append(module.register_forward_hook(after, with_kwargs=True))

    image = ImageOps.fit(Image.open(args.image).convert("RGB"),
                         (args.width, args.height), method=Image.Resampling.LANCZOS)
    try:
        with torch.inference_mode():
            latents = pipe(image, width=args.width, height=args.height, num_frames=args.frames,
                           num_inference_steps=1, generator=torch.Generator(device="cpu").manual_seed(args.seed),
                           output_type="latent").frames
        if torch.isfinite(latents).all().item():
            record["status"] = "ALL_UNET_BOUNDARIES_AND_FINAL_LATENTS_FINITE"
        else:
            record["status"] = "UNET_BOUNDARIES_FINITE_BUT_FINAL_LATENTS_NONFINITE"
    except FoundNonFinite as error:
        record["message"] = str(error)
    except Exception as error:
        record["status"] = "DIAGNOSTIC_EXECUTION_ERROR"
        record["message"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        for handle in handles:
            handle.remove()
        record["elapsed_seconds"] = round(time.monotonic() - started, 3)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record, indent=2), flush=True)


if __name__ == "__main__":
    main()
