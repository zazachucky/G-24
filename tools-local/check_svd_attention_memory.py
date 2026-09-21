"""CPU-only numerical equivalence checks for SVD independent-batch chunking."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "i2v-packages"), str(ROOT / "mps-packages")]
import torch
from diffusers.models.attention_processor import Attention, AttnProcessor2_0
from svd_attention_memory import BatchChunkedSDPAProcessor

torch.set_num_threads(1)
torch.manual_seed(42)
results = []
for name, query_count, key_count, masked in [
    ("spatial_self", 32, None, False),
    ("spatial_cross", 32, 24, False),
    ("masked_spatial_self", 32, None, True),
    ("temporal_short_sequence", 4, None, False),
]:
    attention = Attention(query_dim=16, heads=2, dim_head=8).to("cpu")
    hidden = torch.randn(5, query_count, 16, device="cpu")
    encoder = torch.randn(5, key_count, 16, device="cpu") if key_count else None
    mask = torch.zeros(5, 1, query_count, device="cpu") if masked else None
    if mask is not None:
        mask[:, :, -3:] = -10000
    processor = BatchChunkedSDPAProcessor(batch_chunk=2, min_tokens=8)
    with torch.inference_mode():
        expected = AttnProcessor2_0()(attention, hidden, encoder, mask)
        actual = processor(attention, hidden, encoder, mask)
    torch.testing.assert_close(actual, expected, rtol=1e-5, atol=1e-6)
    results.append({"case": name, "status": "PASS", "device": str(actual.device),
                    "max_abs_error": float((actual - expected).abs().max()),
                    "chunked_calls": processor.chunked_calls,
                    "unchunked_calls": processor.unchunked_calls})
record = {"scope": "CPU only; no GPU inference or performance benchmark", "results": results}
(ROOT / "svd-attention-equivalence.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record, indent=2))
