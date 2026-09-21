# Local LTX I2V preparation

Prepared for the project on 2026-09-21. No generation has been run by this setup task.

- Source: https://github.com/dgrauet/ltx-2-mlx
- Pinned source commit: `3392d75934120b7e69eefbe55893f7ef82be92a4` (0.15.8).
- Official uv 0.12.17 arm64 archive SHA256: `85f00cbdc6dd3e97eba4c31b4d014375a9fdfe8f570023b84e5102fc3456896b`.
- Isolated CPython 3.11.16 from uv's official python-build-standalone distribution; no global Python changes.
- Python environment: `tools-local/ltx-2-mlx/.venv`.
- Installed MLX 0.32.2, mlx-lm 0.31.1, mlx-arsenal 0.2.4; native Metal availability, pipeline import and CLI help passed.
- The two LTX packages are installed as local non-editable wheels. This avoids Python skipping editable `.pth` files when a parent workflow marks tooling files with macOS `UF_HIDDEN`; no global file flags or Python configuration were changed.
- FFmpeg: project-local symlink `tools-local/ltx-bin/ffmpeg` points to the previously installed imageio-ffmpeg arm64 7.1 executable. FFmpeg version check passed.

## Model files

The minimum selected image-to-video pack is 28.547 GB including its separate Gemma encoder. The source README's approximate 12 GB is not a full on-disk download estimate. Only the distilled 1.1 transformer, connector, VAE pair, x2 upscaler, optional audio modules and metadata are selected; dev transformer, old distilled, LoRAs and other upscalers are excluded.

- LTX: `dgrauet/ltx-2.3-mlx-q4`, revision `56a5866d638ecfe37c54d348e88938235185c2d4`.
- Gemma: `mlx-community/gemma-3-12b-it-4bit`, revision `86cc6a8dedbc456dd0e4af01a9d09f396f77e558`.
- Download and SHA256 results: `tools-local/ltx-download-manifest.json`. Its status must be `VERIFIED` before generation.
- Downloader: `python3 tools-local/ltx-download-models.py`. Public HTTP Range, maximum four concurrent connections on one file; per-range resumption; rate-limit/server-error backoff. Published LFS SHA256 values are checked.
- Faster current downloader: `tools-local/ltx-2-mlx/.venv/bin/python -u tools-local/ltx-download-native.py`. Uses installed `huggingface_hub` + `hf_xet` with two files in parallel; completed files are reused and reverified. The measured 258 MB sample finished in 39.08 s, but larger files have variable throughput; see `ltx-download-benchmark.json`. Old Range chunks remain for resumption if needed.

## Run after downloads finish

Do not overlap this with another model's GPU generation on the 24 GB Mac.

```sh
python3 tools-local/ltx-run-i2v.py \
  --image assets/video/full-body/tryon-source.png \
  --prompt-file /path/to/tryon-prompt.txt \
  --output assets/video/full-body/ltx-tryon-proof.mp4
```

Defaults: 384×640, 97 frames at 24 fps (~4.04 s), two-stage distilled (8+3 steps), low-RAM transformer streaming, no generated audio. The command uses local models and disables network downloads. Prompt and reference image jointly condition newly generated motion. `--resident` disables block streaming for a measured speed comparison, but may raise memory pressure. The implementation frees Gemma and connector before loading the transformer; streaming protects DiT memory, not the text encoder phase. No unverified claim of output quality or inference performance is made.

The default proof resolution is **3:5, not 9:16**. Two-stage LTX requires each dimension to be a multiple of 64; the smallest exact 9:16 output is **576×1024** (`--width 576 --height 1024`). Do not request 360×640: upstream silently snaps that width to 320. For a low-cost proof, use the default and crop its accepted footage to 360×640 in the compositor, checking the framing. Exact 576×1024 has 2.4× as many pixels as the proof size and needs separate memory/performance verification.

Memory controls are explicit: `--memory-limit-gb 18` calls MLX's `set_memory_limit`; this is an allocation **guideline**, not a hard process RSS cap. `--decode-budget-gb 8` sets upstream `LTX2_VAE_DECODE_BUDGET_GB`, enabling automatic VAE tiling within its estimated budget. `--low-ram` streams DiT blocks and disables MLX allocator caching; it does not eliminate Gemma's initial memory requirement. The wrapper prints actual peak MLX memory on success or exception. Keep the upstream per-layer evaluation/watchdog settings unchanged and do not shorten Gemma's padded context without a separate quality check.

The source-specific garment motion prompt is `tools-local/ltx-prompts/tryon-hem.txt`. It asks for a small two-handed hem gesture already supported by the source pose, one continuous locked shot, and consistent face/clothing. It does not request unrelated cuts, walking, a fabric change or unobserved product properties.

For the first proof, use a simple garment gesture in a locked shot. Keep the current source image as the first keyframe and do not demand unrelated camera cuts in one 4-second clip. Hands, garment geometry and face consistency must be visually reviewed after generation.

`a2v` is labeled Beta upstream and requires additional dev-model weights; this prepared pack deliberately targets I2V. A separate Korean narration can be composed over the accepted footage. This setup does not promise Korean lip synchronization.
