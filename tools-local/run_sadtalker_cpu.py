"""Run the unchanged official SadTalker CLI with workspace-local tools/caches.

Example (absolute media paths recommended):
  tools-local/venv-sadtalker/bin/python tools-local/run_sadtalker_cpu.py \
    --source_image /absolute/portrait.png --driven_audio /absolute/short.wav \
    --result_dir /absolute/output --size 256 --preprocess crop --batch_size 1
"""
import os
from pathlib import Path
import subprocess
import sys

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
REPO = ROOT / "SadTalker"
BIN = ROOT / "bin"
BIN.mkdir(exist_ok=True)
ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
link = BIN / "ffmpeg"
if not link.exists():
    link.symlink_to(ffmpeg)
env = os.environ.copy()
env["PATH"] = str(BIN) + os.pathsep + env.get("PATH", "")
env["IMAGEIO_FFMPEG_EXE"] = str(ffmpeg)
for key, folder in [("MPLCONFIGDIR", "matplotlib"), ("NUMBA_CACHE_DIR", "numba"),
                    ("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "xdg")]:
    path = ROOT / "cache" / folder
    path.mkdir(parents=True, exist_ok=True)
    env[key] = str(path)
raise SystemExit(subprocess.call([sys.executable, "inference.py", "--cpu", *sys.argv[1:]], cwd=REPO, env=env))
