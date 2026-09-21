"""Use workspace-local modern torch for SadTalker's face renderer on Apple GPU.

The official repository remains unchanged. Preprocessing/audio models run on CPU;
only the face-rendering models use MPS. Requires a successful operator and short
video check before long rendering. Run outside the sandbox to access Metal.
"""
import os
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT / "SadTalker"
OVERLAY = ROOT / "mps-packages"
if not (OVERLAY / "torch").is_dir():
    raise RuntimeError("Workspace-local modern torch overlay is missing")
sys.path.insert(0, str(OVERLAY))
sys.path.insert(1, str(REPO))
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
for key, folder in [("MPLCONFIGDIR", "matplotlib"), ("NUMBA_CACHE_DIR", "numba"),
                    ("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "xdg")]:
    path = ROOT / "cache" / folder
    path.mkdir(parents=True, exist_ok=True)
    os.environ[key] = str(path)

import imageio_ffmpeg
ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
binary_dir = ROOT / "bin"
binary_dir.mkdir(exist_ok=True)
if not (binary_dir / "ffmpeg").exists():
    (binary_dir / "ffmpeg").symlink_to(ffmpeg)
os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ.get("PATH", "")
os.environ["IMAGEIO_FFMPEG_EXE"] = str(ffmpeg)

import torch
if not torch.backends.mps.is_available():
    raise RuntimeError("Apple GPU access is unavailable in this process; request normal sandbox escalation")
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
torch.manual_seed(42)

# basicsr 1.4.2 imports the former torchvision module name.
import torchvision.transforms._functional_tensor as functional_tensor
sys.modules.setdefault("torchvision.transforms.functional_tensor", functional_tensor)

os.chdir(REPO)
from src.facerender.animate import AnimateFromCoeff
from sadtalker_mps_compat import apply_mps_compat

apply_mps_compat()

original_init = AnimateFromCoeff.__init__


def init_with_mps(self, paths, device):
    original_init(self, paths, "cpu")
    self.generator.to("mps")
    self.kp_extractor.to("mps")
    self.mapping.to("mps")
    self.device = "mps"
    print(f"Face renderer: MPS; torch {torch.__version__}; CPU audio/preprocessing", flush=True)


AnimateFromCoeff.__init__ = init_with_mps
sys.argv = [str(REPO / "inference.py"), "--cpu", *sys.argv[1:]]
runpy.run_path(str(REPO / "inference.py"), run_name="__main__")
