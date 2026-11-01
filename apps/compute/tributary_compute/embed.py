"""`local` search embeddings (SPEC M9): a deterministic, dependency-free hashing embedder.

Signed feature hashing of words and character trigrams (Weinberger et al. 2009, "Feature hashing for
large scale multitask learning", ICML, doi:10.1145/1553374.1553516), L2-normalised. It is lexical, not
semantic: it exists so the hybrid pipeline runs offline and in tests. A real local model needs a
dependency approval (ADR 0020).
"""

import hashlib
import math
import re

from tributary_compute.contracts.embed_request import EmbedRequest
from tributary_compute.contracts.embed_response import EmbedResponse
from tributary_compute.stats.errors import ComputeError

MODEL = "hashing-ngram-v1"
WORD = re.compile(r"[^\W_]+(?:-[^\W_]+)*")
WORD_WEIGHT = 1.0
TRIGRAM_WEIGHT = 0.5


def _features(text: str) -> list[tuple[str, float]]:
    out: list[tuple[str, float]] = []
    for word in WORD.findall(text.lower()):
        forms = {word, word.replace("-", "")}
        for form in forms:
            out.append((f"w:{form}", WORD_WEIGHT))
        padded = f"#{word.replace('-', '')}#"
        out.extend((f"c:{padded[i : i + 3]}", TRIGRAM_WEIGHT) for i in range(len(padded) - 2))
    return out


def _vector(text: str, dims: int) -> list[float]:
    v = [0.0] * dims
    for feature, weight in _features(text):
        h = int.from_bytes(hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest(), "big")
        v[h % dims] += weight if (h >> 63) & 1 else -weight
    norm = math.sqrt(sum(x * x for x in v))
    return [x / norm for x in v] if norm > 0 else v


def embed(request: EmbedRequest) -> EmbedResponse:
    texts = [t.root for t in request.texts]
    for i, text in enumerate(texts):
        if not WORD.search(text):
            raise ComputeError("empty_text", f"texts.{i}", "Text has no words to embed.")
    return EmbedResponse(model=MODEL, dims=request.dims, embeddings=[_vector(t, request.dims) for t in texts])
