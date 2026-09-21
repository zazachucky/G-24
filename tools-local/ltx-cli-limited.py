"""Apply explicit MLX memory guidelines, then enter the unmodified upstream CLI."""
import argparse
import json
import sys
import mlx.core as mx

parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--memory-limit-gb", type=float, default=18.0)
args, upstream_args = parser.parse_known_args()
if args.memory_limit_gb <= 0:
    raise SystemExit("Memory guideline must be positive.")
mx.set_memory_limit(int(args.memory_limit_gb * 1024**3))
mx.set_cache_limit(0)
sys.argv = [sys.argv[0]] + upstream_args
from ltx_pipelines_mlx.cli import main
try:
    main()
finally:
    print(json.dumps({"mlx_peak_GiB": mx.get_peak_memory()/1024**3, "mlx_active_GiB": mx.get_active_memory()/1024**3, "memory_guideline_GiB": args.memory_limit_gb, "is_hard_process_rss_limit": False}), file=sys.stderr, flush=True)
