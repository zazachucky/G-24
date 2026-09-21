# Source-only review: image + Korean audio conditioning

Status: **SUPPORTED BY UPSTREAM A2V, NOT READY WITH THE CURRENT MINIMAL PACK, NOT EXECUTED**.

Reviewed commit `3392d75934120b7e69eefbe55893f7ef82be92a4`. No additional model download or inference was started for this review.

## Requirements

`A2VidPipelineTwoStage` accepts both an audio track and reference image. CLI `a2v --audio ... --image ...` passes both inputs into the same pipeline. The audio is encoded and frozen during the first stage, while the source image conditions the first frame. The second stage refines video and audio. The final MP4 uses the original supplied audio resampled to 48 kHz, rather than newly synthesized speech.

The current 28.547 GB distilled I2V pack lacks `transformer-dev.safetensors`. `_load_dev_transformer()` explicitly raises when this file is missing, so changing `generate` to `a2v` alone will not work.

- Additional required file: `dgrauet/ltx-2.3-mlx-q4/transformer-dev.safetensors`, **11,322,002,285 bytes**, at the same pinned model revision.
- With `--low-ram` and default distilled LoRA strength 1.0, stage 2 swaps to the current pre-fused `transformer-distilled-1.1.safetensors`. No separate 7.606 GB LoRA download is required on this path.
- The existing `audio_vae.safetensors` already contains **44 audio encoder tensors**, verified from its safetensors header without GPU loading. Its audio decoder and the existing vocoder are also available.
- A2V is classified **Beta** upstream: audiovisual alignment depends on a sufficiently specific prompt. No Korean lip-sync result has been validated locally.

## Length and dimensions

`assets/video/full-body/audio/tryon.wav` is **5.7738322 s**, mono 22,050 Hz.

- 145 video frames at 24 fps = **6.0416667 s**, an allowed `8k+1` frame count.
- Pad the WAV's tail with approximately **0.2678345 s** silence first. The upstream `load_audio()` truncates to a maximum duration but does not pad short input, while A2V builds positions for the requested video's audio token count. Supplying an undersized waveform risks a latent/position length mismatch.
- 384×640 remains a low-cost proof size, not exact 9:16. Exact two-stage 9:16 is 576×1024 or an integer multiple.

Example audio preparation (not run):

```sh
tools-local/ltx-bin/ffmpeg -i assets/video/full-body/audio/tryon.wav \
  -af 'apad,atrim=duration=6.0416666667' -ar 48000 -ac 2 \
  assets/video/full-body/audio/tryon-a2v-145f.wav
```

## Prospective command after separately obtaining the dev weights

```sh
PATH="$PWD/tools-local/ltx-bin:$PATH" \
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
LTX2_VAE_DECODE_BUDGET_GB=8 \
tools-local/ltx-2-mlx/.venv/bin/python tools-local/ltx-cli-limited.py \
  --memory-limit-gb 18 a2v \
  --model tools-local/ltx-model-q4 \
  --gemma tools-local/ltx-gemma-q4 \
  --audio assets/video/full-body/audio/tryon-a2v-145f.wav \
  --image assets/video/full-body/tryon-source.png \
  --prompt 'A continuous realistic home-shopping presentation. The fictional adult woman in the reference image speaks Korean directly to the camera in sync with the supplied speech, with natural mouth movements and gentle two-handed gestures at the hem of her charcoal gray pullover. Preserve her face, outfit and warm studio setting. Locked portrait shot.' \
  --height 640 --width 384 --frames 145 --frame-rate 24 \
  --stage1-steps 30 --stage2-steps 3 --cfg-scale 3 --stg-scale 1 \
  --low-ram --output assets/video/full-body/ltx-a2v-proof.mp4
```

The command deliberately does not contain `--no-audio`. The upstream A2V implementation always remuxes the original provided audio; its CLI path does not use the generation command's `generate_audio` switch.

## Resource implications

- At equal resolution, increasing 97 to 145 frames increases temporal latent frames from **13 to 19**, approximately **46% more video tokens**; attention/activation growth is not strictly linear.
- A2V stage 1 defaults to **30 guided steps**, compared with distilled I2V's **8 unguided steps**. Guidance evaluates extra model branches, and two text contexts must be encoded. Expect substantially more computation; no trustworthy runtime multiplier is available without a local run.
- The two transformer checkpoints are streamed sequentially in low-RAM mode, so the extra 11.322 GB on disk does not imply both checkpoints are resident in memory together.
- Use the same 18 GiB MLX guideline and 8 GiB VAE tiling budget for the first test, then inspect measured peak. These are not hard process-RSS guarantees.

## Source locations

- `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/cli.py`: A2V parser and `_cmd_a2v`.
- `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/a2vid_two_stage.py`: joint image/audio conditioning and original-audio mux.
- `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/_base.py`: required dev checkpoint check.
- `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/ti2vid_two_stages.py`: low-RAM distilled checkpoint swap.
- `packages/ltx-pipelines-mlx/src/ltx_pipelines_mlx/utils/blocks.py`: audio encoder loading.
- `docs/PIPELINE_MATURITY.md`: A2V Beta status and synchronization limitation.
