"""Decode five review frames from an actual SVD MP4 using CPU FFmpeg."""
import argparse
import json
from pathlib import Path
import imageio.v2 as imageio

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("video", type=Path)
args = parser.parse_args()
output = args.video.with_name(args.video.stem + "-qa")
output.mkdir(exist_ok=True)
reader = imageio.get_reader(str(args.video), "ffmpeg")
metadata = reader.get_meta_data()
metadata = {key: metadata.get(key) for key in ["plugin", "codec", "pix_fmt", "fps", "source_size", "size", "duration"]}
saved = []
count = 0
try:
    for index, frame in enumerate(reader):
        count += 1
        if index in [0, 6, 12, 18, 24]:
            destination = output / f"frame-{index:03d}.png"
            imageio.imwrite(destination, frame)
            saved.append({"index": index, "path": str(destination),
                          "time_s": index / metadata["fps"]})
finally:
    reader.close()
if count != 25 or len(saved) != 5:
    raise RuntimeError(f"Unexpected frame count: decoded={count}, review={len(saved)}")
record = {"video": str(args.video), "status": "CONTAINER_DECODE_PASS_VISUAL_REVIEW_PENDING",
          "decoded_frames": count, "metadata": metadata, "review_frames": saved}
(output / "decode-verification.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"decoded_frames": count, "fps": metadata["fps"],
                  "duration_s": metadata.get("duration"), "size": metadata.get("size"),
                  "review_directory": str(output)}, indent=2))
