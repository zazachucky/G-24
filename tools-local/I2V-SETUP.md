# Local SVD-XT proof environment

The isolated `i2v-packages` directory adds Diffusers 0.35.1 and supporting packages.
The existing Python 3.9 SadTalker venv supplies common dependencies; the existing
`mps-packages` overlay supplies torch 2.8.0 and torchvision 0.23.0. Neither existing
environment is modified. Exact additions are in `i2v-requirements.txt`.

The model is the official
[stabilityai/stable-video-diffusion-img2vid-xt](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt).
Only three fp16 safetensors files, six JSON configuration files, and the upstream
README/license are downloaded (4,509,208,849 bytes total). The downloader pins the
current repository revision and verifies the published LFS SHA256 hashes. See
`models/stable-video-diffusion-img2vid-xt/download-manifest.json` for exact files.

Verified on this M5 Mac: MPS fp16 Conv3d passes, all 44 direct package dependency
conditions pass, all official model files are verified, and the complete fp16
pipeline loads onto MPS in 3.111 seconds. Verified model revision:
`9e43909513c6714f1bc78bcb44d96e733cd242aa`. This setup verification does not generate
video or establish motion quality; see `i2v-environment-verification.json`.

Subsequent actual inference exposed non-finite fp16 UNet output on this M5/MPS
setup, even at 128×224 with 2 frames. Input embeddings, VAE encoding, and UNet
inputs remained finite. Explicit fp32 and bf16 computation both passed a tiny
2-frame, 2-step end-to-end generation. Use **`--dtype bf16`** for the next full
proof; it keeps model allocations around 4.51 GB in the tiny diagnostic, versus
9.02 GB for fp32. The bf16 wrapper explicitly converts all components and casts
the VAE input to its actual dtype. No replacement model downloads are required.
See `svd-precision-diagnostics.json`. Tiny diagnostic clips are not useful video
deliverables, and larger-frame inference/motion quality still needs validation.

The official model generates short silent motion from one input image. It has no
text-action control, lip synchronization, or guarantee of precise hands or garment
preservation. Its training frame dimensions are width 1024 × height 576; portrait
inputs are an experiment and need visual inspection. This is intended for local
prototype evaluation; the upstream license remains beside the weights.

From the project root:

```sh
tools-local/venv-sadtalker/bin/python tools-local/download_svd_models.py
tools-local/venv-sadtalker/bin/python tools-local/run_svd_probe.py --check-env
tools-local/venv-sadtalker/bin/python tools-local/run_svd_probe.py --load-only
tools-local/venv-sadtalker/bin/python tools-local/run_svd_probe.py \
  --image assets/video/full-body/tryon-source.png \
  --output assets/video/full-body/tryon-proof-svd.mp4 \
  --width 320 --height 576 --frames 25 --fps 6 --steps 25 \
  --motion 127 --seed 42 --decode-chunk 1 --dtype bf16 \
  --sdpa-batch-chunk 4 --empty-cache-each-step
```

The generation command uses Apple MPS bfloat16, the upstream forward chunking setting,
and a seeded CPU random generator. It writes an MP4, all 25 PNG frames, the resized
conditioning image, and JSON provenance/timings. Output paths must be new. It
performs a finite-value check after each diffusion step. The generated clip is
marked `GENERATED_REQUIRES_VISUAL_REVIEW`, since a valid video container alone does
not establish useful person motion.

Optional `--offload` uses upstream Accelerate model CPU offload for MPS. It is off by
default; no Metal memory safety limits are disabled. `--check-env` runs a small
fp16 Conv3d check without loading or generating video; `--load-only` loads the model
but does not perform inference.

`--dtype fp16|fp32|bf16` controls computation precision independently of the fp16
checkpoint files; `--diagnose` checks and prints major pipeline tensor boundaries.

## Attention memory correction

A 320×576, 25-frame bf16 run passed finite-value checks but slowed sharply while
the operating system swapped memory. The post-step tensor allocation (~4.53 GB)
does not include all Metal driver and allocator memory. At the first spatial
attention resolution, the potential attention-score shape is
`50 batches × 5 heads × 2880 queries × 2880 keys`: 4.15 GB at bf16 or 8.29 GB if
computed internally at fp32. The existing feed-forward chunking does not split
this attention operation.

`--sdpa-batch-chunk 4` is now the default. `svd_attention_memory.py` delegates to
the original PyTorch SDPA processor in chunks of four independent spatial batches
when both token counts are at least 512. Each frame retains all its spatial
tokens; short temporal attention and small cross-attention are unchanged. The
largest score allocation is theoretically reduced 12.5-fold for this input.
Four CPU equivalence cases (self, cross, masked, and short temporal attention)
match the original processor exactly; see `svd-attention-equivalence.json`.
GPU peak memory, speed, and full inference remain to be measured after this patch.
Pass `--sdpa-batch-chunk 0` to reproduce the original unsplit behavior.

The old implementation of `--attention-slicing` called
`pipe.enable_attention_slicing()`, which **did not affect this SVD UNet** because
`UNetSpatioTemporalConditionModel` has no `set_attention_slice` method. The option
now explicitly installs the upstream sliced processor on individual UNet
Attention modules. This is an alternative to batch-chunked SDPA and is expected
to involve more small operations. Do not enable both methods together.

`--empty-cache-each-step` releases unused allocator cache after each completed
step. It can address retained cache between steps but cannot remove the live
peak inside an attention operation. Step logs now include tensor allocation,
driver allocation before/after cache clearing, recommended maximum memory, and
the number of chunked attention calls. `--memory-fraction 0.75`, for example,
sets a hard allocator limit relative to Metal's recommended working set; it is
a guardrail that may raise OOM, not a speed optimization. No system processes
are touched by these options.

`--ff-chunk 1` preserves the original feed-forward setting. `--ff-chunk 5` is an
optional throughput experiment for 25 frames; it reduces feed-forward dispatches
while retaining the same mathematical operation. The helper checks that the
chunk divides both the temporal frame count and spatial guidance/frame batch.
Tiny-input speed and memory measurements are recorded below.

For a separate, tiny fp16 module-boundary diagnosis, only after other MPS jobs end:

```sh
tools-local/venv-sadtalker/bin/python tools-local/diagnose_svd_fp16_modules.py \
  --image assets/video/full-body/tryon-source.png \
  --report tools-local/svd-fp16-module-diagnostic.json
```

The script checks inputs and outputs of UNet modules at 128×224, 2 frames,
1 step, records the first non-finite boundary, and stops. It deliberately uses
synchronizing checks, so it is not a performance benchmark. Preparation and
syntax checks and the authorized GPU diagnostic have completed; results follow.

## Targeted fp16 recovery and feed-forward measurement

The subsequent authorized module diagnosis found the first non-finite tensor at
the input to `up_blocks.3.attentions.1.transformer_blocks.0.attn1.to_out.0`.
After correcting that layer, the corresponding self-attention in `attentions.2`
was the next failure. Both failures occurred after Q/K/V projections and before
the output projection. Applying the upstream `AttnProcessor` with
`upcast_attention=True` and `upcast_softmax=True` to those two layers made all
4,019 checked UNet module boundaries and the final latent finite in the tiny
1-step diagnostic. Model parameters and other calculations remain fp16.

The helper accepts repeated `--attention-upcast-layer` arguments. Targeted upcast
also respects the independent-batch memory chunking when active. A next full-size
experiment may use:

```sh
--dtype fp16 --ff-chunk 5 \
--attention-upcast-layer up_blocks.3.attentions.1.transformer_blocks.0.attn1 \
--attention-upcast-layer up_blocks.3.attentions.2.transformer_blocks.0.attn1
```

At 128×224, 25 frames, and 2 denoising steps, both chunk settings completed with
finite latents and nonblack decoded frames:

| FF chunk | Denoising step 2 time | Whole inference including decode | Driver allocation |
| --- | ---: | ---: | ---: |
| 1 | 7.99 s | 20.929 s | ~7.21 GB |
| 5 | 3.15 s | 10.425 s | ~7.20 GB |

These are two separate runs, not a statistical benchmark. At this small resolution
the spatial-token count is 448, so attention batch chunking was not triggered.
The result supports FF chunk 5 as a next experiment; it does not establish
full-resolution stability, a guaranteed speedup, or acceptable video quality.
Both diagnostic clips have only two denoising steps and are not deliverables.
Full records: `svd-fp16-recovery-benchmark.json`.

Reference:
[Diffusers 0.35.1 SVD guide](https://huggingface.co/docs/diffusers/v0.35.1/en/using-diffusers/svd).
