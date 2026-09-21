"""Split independent spatial-attention batches without changing token attention.

SVD combines guidance and video frames in the spatial attention batch. Splitting
that batch preserves each frame's complete spatial attention. Temporal attention
has a short query sequence and is deliberately left intact.
"""

import torch
from diffusers.models.attention_processor import AttnProcessor2_0


class BatchChunkedSDPAProcessor:
    def __init__(self, batch_chunk=4, min_tokens=512):
        if batch_chunk < 1 or min_tokens < 1:
            raise ValueError("Attention chunk and token threshold must be positive")
        self.batch_chunk = batch_chunk
        self.min_tokens = min_tokens
        self.original = AttnProcessor2_0()
        self.chunked_calls = 0
        self.unchunked_calls = 0

    def __call__(self, attn, hidden_states, encoder_hidden_states=None,
                 attention_mask=None, temb=None):
        if hidden_states.ndim != 3:
            self.unchunked_calls += 1
            return self.original(attn, hidden_states, encoder_hidden_states, attention_mask, temb)
        batch, query_tokens, _ = hidden_states.shape
        key_tokens = encoder_hidden_states.shape[1] if encoder_hidden_states is not None else query_tokens
        should_chunk = (batch > self.batch_chunk and query_tokens >= self.min_tokens
                        and key_tokens >= self.min_tokens
                        and (encoder_hidden_states is None or encoder_hidden_states.shape[0] == batch))
        if not should_chunk:
            self.unchunked_calls += 1
            return self.original(attn, hidden_states, encoder_hidden_states, attention_mask, temb)

        self.chunked_calls += 1
        pieces = []
        for start in range(0, batch, self.batch_chunk):
            stop = min(start + self.batch_chunk, batch)
            encoder = encoder_hidden_states[start:stop] if encoder_hidden_states is not None else None
            mask = attention_mask
            if mask is not None and mask.shape[0] == batch:
                mask = mask[start:stop]
            elif mask is not None and mask.shape[0] == batch * attn.heads:
                mask = mask[start * attn.heads:stop * attn.heads]
            elif mask is not None and mask.shape[0] != 1:
                raise ValueError("Unsupported attention-mask batch shape for exact chunking")
            time_embedding = temb[start:stop] if temb is not None and temb.shape[0] == batch else temb
            pieces.append(self.original(attn, hidden_states[start:stop], encoder, mask, time_embedding))
        return torch.cat(pieces, dim=0)


def install_batch_chunked_sdpa(unet, batch_chunk):
    processors = {name: BatchChunkedSDPAProcessor(batch_chunk=batch_chunk)
                  for name in unet.attn_processors}
    # Diffusers consumes/pops this dictionary while traversing modules.
    retained = list(processors.values())
    unet.set_attn_processor(processors)
    return retained


def install_real_attention_slicing(unet, slice_size=2):
    """SVD's UNet has no public set_attention_slice; set each Attention directly."""
    from diffusers.models.attention_processor import Attention
    count = 0
    for module in unet.modules():
        if isinstance(module, Attention):
            module.set_attention_slice(min(slice_size, module.sliceable_head_dim))
            count += 1
    return count


def install_attention_score_upcast(unet, module_names):
    """Use upstream fp32 QK/softmax on explicitly identified unstable layers only."""
    from diffusers.models.attention_processor import Attention, AttnProcessor
    installed = []
    for name in module_names:
        module = unet.get_submodule(name)
        if not isinstance(module, Attention):
            raise ValueError(f"Requested upcast target is not Attention: {name}")
        if module.norm_q is not None or module.norm_k is not None:
            raise ValueError(f"Legacy upcast processor does not implement Q/K norm: {name}")
        module.upcast_attention = True
        module.upcast_softmax = True
        if isinstance(module.processor, BatchChunkedSDPAProcessor):
            module.processor.original = AttnProcessor()
        else:
            module.set_processor(AttnProcessor())
        installed.append(name)
    return installed
