"""Run the prepared local distilled I2V pipeline. Does not download models."""
from pathlib import Path
import argparse
import json
import os
import subprocess

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--image", required=True, type=Path)
parser.add_argument("--output", required=True, type=Path)
parser.add_argument("--prompt-file", required=True, type=Path)
parser.add_argument("--width", type=int, default=384)
parser.add_argument("--height", type=int, default=640)
parser.add_argument("--frames", type=int, default=97)
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--resident", action="store_true", help="Keep DiT resident instead of default low-RAM streaming")
parser.add_argument("--memory-limit-gb", type=float, default=18.0, help="MLX allocation guideline, not a hard RSS cap")
parser.add_argument("--decode-budget-gb", type=float, default=8.0, help="VAE automatic tiling memory estimate budget")
args = parser.parse_args()
manifest = json.loads((HERE / "ltx-download-manifest.json").read_text())
if manifest.get("status") != "VERIFIED":
    raise SystemExit("Model download/hash verification has not completed.")
if not args.image.is_file():
    raise SystemExit(f"Missing source image: {args.image}")
if args.output.exists():
    raise SystemExit(f"Refusing to overwrite existing output: {args.output}")
args.output.parent.mkdir(parents=True, exist_ok=True)
command = [
    str(HERE / "ltx-2-mlx/.venv/bin/python"), str(HERE / "ltx-cli-limited.py"),
    "--memory-limit-gb", str(args.memory_limit_gb), "generate",
    "--model", str(HERE / "ltx-model-q4"),
    "--gemma", str(HERE / "ltx-gemma-q4"),
    "--distilled", "--frame-rate", "24", "--no-audio",
    "--image", str(args.image.resolve()),
    "--prompt", args.prompt_file.read_text().strip(),
    "--output", str(args.output.resolve()),
    "--width", str(args.width), "--height", str(args.height),
    "--frames", str(args.frames), "--seed", str(args.seed),
]
if not args.resident:
    command.append("--low-ram")
environment = os.environ.copy()
environment["PATH"] = str(HERE / "ltx-bin") + os.pathsep + environment.get("PATH", "")
environment["HF_HUB_OFFLINE"] = "1"
environment["TRANSFORMERS_OFFLINE"] = "1"
environment["PYTHONUNBUFFERED"] = "1"
environment["HF_HOME"] = str(HERE / "ltx-hf-cache")
environment["LTX2_VAE_DECODE_BUDGET_GB"] = str(args.decode_budget_gb)
print(json.dumps({"command": command, "source_image": str(args.image.resolve()), "method": "LTX-2.3 Q4 distilled image-conditioned video generation", "generated_audio": False}, indent=2), flush=True)
subprocess.run(command, env=environment, check=True)
