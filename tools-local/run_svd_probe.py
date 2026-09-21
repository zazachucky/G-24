"""Local SVD-XT image-to-video proof; original SadTalker packages stay untouched.

This model accepts one image and motion controls, not a text action prompt.
It produces silent clips and does not promise lip sync or precise hand actions.
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS / "i2v-packages"), str(TOOLS / "mps-packages")]
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HOME", str(TOOLS / "cache" / "huggingface-i2v"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def versions():
    names = ["torch", "torchvision", "diffusers", "transformers", "accelerate",
             "huggingface-hub", "tokenizers", "safetensors", "numpy", "Pillow", "imageio-ffmpeg"]
    return {name: importlib.metadata.version(name) for name in names}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--model", type=Path,
                        default=TOOLS / "models" / "stable-video-diffusion-img2vid-xt")
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=576)
    parser.add_argument("--frames", type=int, default=25)
    parser.add_argument("--steps", type=int, default=25)
    parser.add_argument("--fps", type=int, default=7)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--motion", type=int, default=100)
    parser.add_argument("--noise", type=float, default=0.02)
    parser.add_argument("--decode-chunk", type=int, default=2)
    parser.add_argument("--ff-chunk", type=int, default=1)
    parser.add_argument("--min-guidance", type=float, default=1.0)
    parser.add_argument("--max-guidance", type=float, default=3.0)
    parser.add_argument("--offload", action="store_true")
    parser.add_argument("--attention-slicing", action="store_true")
    parser.add_argument("--sdpa-batch-chunk", type=int, default=None)
    parser.add_argument("--empty-cache-each-step", action="store_true")
    parser.add_argument("--memory-fraction", type=float, default=0.0)
    parser.add_argument("--dtype", choices=["fp16", "fp32", "bf16"], default="fp16")
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--attention-upcast-layer", action="append", default=[])
    parser.add_argument("--load-only", action="store_true")
    parser.add_argument("--check-env", action="store_true")
    args = parser.parse_args()
    if args.width % 8 or args.height % 8:
        parser.error("Width and height must be multiples of 8")
    guidance_batch = 2 if args.max_guidance > 1.0 else 1
    spatial_batch = guidance_batch * args.frames
    if args.ff_chunk < 1 or args.frames % args.ff_chunk or spatial_batch % args.ff_chunk:
        parser.error(f"FF chunk must be positive and divide both temporal frames ({args.frames}) "
                     f"and spatial guidance/frame batch ({spatial_batch})")
    if args.attention_slicing and args.sdpa_batch_chunk not in (None, 0):
        parser.error("Choose either sliced attention or batch-chunked SDPA")
    if args.sdpa_batch_chunk is None:
        args.sdpa_batch_chunk = 0 if args.attention_slicing else 4
    if args.sdpa_batch_chunk < 0:
        parser.error("SDPA batch chunk cannot be negative")
    if args.memory_fraction and not 0 < args.memory_fraction <= 1:
        parser.error("Memory fraction must be between 0 and 1")
    if not args.check_env and not args.load_only and (not args.image or not args.output):
        parser.error("--image and --output are required for generation")
    if args.output and args.output.exists():
        parser.error("Output already exists; choose a new path")

    import torch
    import numpy as np
    from diffusers import StableVideoDiffusionPipeline

    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    available = torch.backends.mps.is_available()
    record = {"versions": versions(), "mps_available": available,
              "model_directory": str(args.model.resolve()),
              "limitations": ["silent image-to-video; no text prompt control", "no speech lip sync",
                              "no guaranteed hand choreography or garment identity preservation"]}
    if not available:
        raise RuntimeError("Apple Metal MPS is not available in this process")
    if args.memory_fraction:
        torch.mps.set_per_process_memory_fraction(args.memory_fraction)
    # Test the temporal decoder's basic operator family without model inference.
    sample = torch.ones((1, 2, 3, 8, 8), device="mps", dtype=torch.float16)
    conv = torch.nn.Conv3d(2, 2, 3, padding=1).to(device="mps", dtype=torch.float16)
    with torch.inference_mode():
        result = conv(sample)
    torch.mps.synchronize()
    record["mps_fp16_conv3d_finite"] = bool(torch.isfinite(result).all().item())
    del sample, conv, result
    torch.mps.empty_cache()
    print(json.dumps(record, ensure_ascii=False, indent=2), flush=True)
    if args.check_env:
        record["status"] = "ENVIRONMENT_CHECKED_NO_MODEL_LOADED"
        (TOOLS / "i2v-environment-verification.json").write_text(json.dumps(record, indent=2) + "\n")
        return

    manifest_path = args.model / "download-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        record["model_revision"] = manifest.get("revision")
        record["model_files_verified"] = all(row.get("verified", False) for row in manifest["files"])
        if not record["model_files_verified"]:
            raise RuntimeError("Model download manifest is not fully verified")

    started = time.monotonic()
    inference_dtype = {"fp16": torch.float16, "fp32": torch.float32, "bf16": torch.bfloat16}[args.dtype]
    record["inference_dtype"] = args.dtype
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        str(args.model), torch_dtype=inference_dtype, variant="fp16",
        use_safetensors=True, local_files_only=True, low_cpu_mem_usage=True,
    )
    # Explicitly convert every component; transformer loaders may retain fp16 weights.
    pipe.to(dtype=inference_dtype)
    pipe.unet.enable_forward_chunking(chunk_size=args.ff_chunk, dim=0)
    attention_processors = []
    if args.attention_slicing:
        from svd_attention_memory import install_real_attention_slicing
        record["sliced_attention_modules"] = install_real_attention_slicing(pipe.unet)
    if args.sdpa_batch_chunk:
        from svd_attention_memory import install_batch_chunked_sdpa
        attention_processors = install_batch_chunked_sdpa(pipe.unet, args.sdpa_batch_chunk)
    if args.attention_upcast_layer:
        from svd_attention_memory import install_attention_score_upcast
        record["attention_upcast_layers"] = install_attention_score_upcast(pipe.unet, args.attention_upcast_layer)
    if args.offload:
        pipe.enable_model_cpu_offload(device="mps")
    else:
        pipe.to("mps")
    record["component_dtypes"] = {name: str(next(component.parameters()).dtype)
                                 for name, component in pipe.components.items()
                                 if isinstance(component, torch.nn.Module)}
    record["load_seconds"] = round(time.monotonic() - started, 3)
    record["status"] = "MODEL_LOADED_NO_VIDEO_GENERATED"
    print(json.dumps({"status": record["status"], "load_seconds": record["load_seconds"]}), flush=True)
    if args.load_only:
        (TOOLS / "i2v-environment-verification.json").write_text(json.dumps(record, indent=2) + "\n")
        return

    if args.dtype == "bf16":
        # The upstream pipeline preprocesses to float32 but only auto-casts fp16 VAE.
        original_vae_encoder = pipe._encode_vae_image
        def encode_bf16_image(image, *positional, **keywords):
            return original_vae_encoder(image.to(dtype=pipe.vae.dtype), *positional, **keywords)
        pipe._encode_vae_image = encode_bf16_image

    if args.diagnose:
        def inspect_tensor(name, value):
            finite = bool(torch.isfinite(value).all().item())
            summary = {"diagnostic": name, "shape": list(value.shape), "dtype": str(value.dtype),
                       "finite": finite, "min": float(value.float().min().item()),
                       "max": float(value.float().max().item())}
            print(json.dumps(summary), flush=True)
            if not finite:
                raise RuntimeError(f"First non-finite diagnostic boundary: {name}")

        for method_name in ["_encode_image", "_encode_vae_image"]:
            original = getattr(pipe, method_name)
            def checked_method(*positional, _original=original, _name=method_name, **keywords):
                value = _original(*positional, **keywords)
                inspect_tensor(_name, value)
                return value
            setattr(pipe, method_name, checked_method)
        original_unet = pipe.unet.forward
        def checked_unet(*positional, **keywords):
            inspect_tensor("unet.input", positional[0])
            inspect_tensor("unet.encoder_hidden_states", keywords["encoder_hidden_states"])
            value = original_unet(*positional, **keywords)
            inspect_tensor("unet.output", value[0])
            return value
        pipe.unet.forward = checked_unet

    from PIL import Image, ImageOps
    import imageio.v2 as imageio
    import imageio_ffmpeg

    os.environ["IMAGEIO_FFMPEG_EXE"] = imageio_ffmpeg.get_ffmpeg_exe()
    image = Image.open(args.image).convert("RGB")
    source_size = list(image.size)
    # Keep proportions; a small centered crop is explicit in the provenance record.
    image = ImageOps.fit(image, (args.width, args.height), method=Image.Resampling.LANCZOS)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frame_dir = args.output.with_suffix("")
    frame_dir.mkdir(exist_ok=True)
    image.save(frame_dir / "input-resized.png")
    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    inference_start = time.monotonic()

    def callback(pipeline, step, timestep, state):
        torch.mps.synchronize()
        elapsed = time.monotonic() - inference_start
        latents = state["latents"]
        if not bool(torch.isfinite(latents).all().item()):
            raise RuntimeError(f"Non-finite latents at inference step {step + 1}")
        driver_before = torch.mps.driver_allocated_memory()
        if args.empty_cache_each_step:
            torch.mps.empty_cache()
        print(json.dumps({"step": step + 1, "total_steps": args.steps,
                          "elapsed_seconds": round(elapsed, 2),
                          "mps_allocated_gb": round(torch.mps.current_allocated_memory() / 1e9, 3),
                          "mps_driver_before_cache_clear_gb": round(driver_before / 1e9, 3),
                          "mps_driver_allocated_gb": round(torch.mps.driver_allocated_memory() / 1e9, 3),
                          "mps_recommended_max_gb": round(torch.mps.recommended_max_memory() / 1e9, 3),
                          "chunked_attention_calls": sum(p.chunked_calls for p in attention_processors)}), flush=True)
        return state

    with torch.inference_mode():
        frames = pipe(
            image, height=args.height, width=args.width, num_frames=args.frames,
            num_inference_steps=args.steps, fps=args.fps,
            min_guidance_scale=args.min_guidance, max_guidance_scale=args.max_guidance,
            motion_bucket_id=args.motion, noise_aug_strength=args.noise,
            decode_chunk_size=args.decode_chunk, generator=generator,
            callback_on_step_end=callback,
        ).frames[0]
    torch.mps.synchronize()
    record["inference_seconds"] = round(time.monotonic() - inference_start, 3)
    pixels = [np.asarray(frame) for frame in frames]
    for index, frame in enumerate(frames):
        frame.save(frame_dir / f"frame-{index:03d}.png")
    with imageio.get_writer(str(args.output), fps=args.fps, codec="libx264",
                            quality=8, macro_block_size=1, pixelformat="yuv420p") as writer:
        for frame in pixels:
            writer.append_data(frame)
    motion = [float(np.abs(b.astype(np.float32) - a.astype(np.float32)).mean())
              for a, b in zip(pixels[:-1], pixels[1:])]
    record.update({"status": "GENERATED_REQUIRES_VISUAL_REVIEW", "source_image": str(args.image.resolve()),
                   "source_size": source_size, "input_fit": "center_crop_preserve_aspect",
                   "output": str(args.output.resolve()), "frames": len(frames), "fps": args.fps,
                   "duration_s": len(frames) / args.fps, "width": args.width, "height": args.height,
                   "seed": args.seed, "steps": args.steps, "motion_bucket_id": args.motion,
                   "noise_aug_strength": args.noise, "decode_chunk_size": args.decode_chunk,
                   "ff_chunk": args.ff_chunk,
                   "min_guidance_scale": args.min_guidance, "max_guidance_scale": args.max_guidance,
                   "offload": args.offload, "attention_slicing": args.attention_slicing,
                   "sdpa_batch_chunk": args.sdpa_batch_chunk,
                   "empty_cache_each_step": args.empty_cache_each_step,
                   "memory_fraction": args.memory_fraction,
                   "mean_adjacent_frame_pixel_delta": float(np.mean(motion)),
                   "first_frame_pixel_stddev": float(pixels[0].std()),
                   "last_frame_pixel_stddev": float(pixels[-1].std()),
                   "elapsed_seconds": round(time.monotonic() - started, 3)})
    args.output.with_suffix(".json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(record, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
