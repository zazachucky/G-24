"""Publish only browser assets; Python source and working files stay private."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIRS = ("assets/products", "assets/lookbooks", "assets/video/reference",
              "assets/video/test-live", "assets/video/sample-live")
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico",
              ".mp4", ".webm", ".vtt", ".mp3", ".wav", ".json"}


def build(root=ROOT, output=None):
    output = output or root / "public"
    if output.exists():
        shutil.rmtree(output)
    files = [file for file in (root / "app").iterdir()
             if file.suffix in {".html", ".css", ".js"}]
    for directory in ASSET_DIRS:
        files.extend(file for file in (root / directory).rglob("*")
                     if file.is_file() and file.suffix.lower() in EXTENSIONS)
    for file in files:
        target = output / file.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    print(f"Published {len(files)} static assets to {output.name}/")


if __name__ == "__main__":
    build()
