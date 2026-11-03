"""Over-representation analysis (ORA) of a hit list against gene sets (Phase 24, ENR-01).

For each set with K members in the background of N identifiers, and k of the n hits in the set, the p-value is
P(X >= k) for X ~ Hypergeometric(N, K, n), one-sided (Rivals et al. 2007, doi:10.1093/bioinformatics/btl633).
p-values are adjusted across the tested sets with Benjamini-Hochberg (doi:10.1111/j.2517-6161.1995.tb02031.x).
Set members outside the background are ignored; sets whose size within the background is outside
[min_size, max_size] are not tested and are counted instead.
"""

from tributary_compute.contracts.enrichment_request import EnrichmentRequest
from tributary_compute.contracts.enrichment_result import EnrichmentResult, Term
from tributary_compute.stats.errors import COMPUTE_VERSION, ComputeError
from tributary_compute.stats.scipy_api import fdr, hypergeom_sf


def enrichment(request: EnrichmentRequest) -> EnrichmentResult:
    background = {item.root for item in request.background}
    hits = {item.root for item in request.hits}
    outside = sorted(hits - background)
    if outside:
        raise ComputeError(
            "hits_not_in_background",
            "hits",
            f"{len(outside)} hits are not in the background (e.g. {outside[0]}); "
            "hits must be measured features.",
        )
    if request.min_size > request.max_size:
        raise ComputeError("invalid_size_range", "min_size", "min_size must not exceed max_size.")
    big_n, n = len(background), len(hits)

    tested: list[tuple[str, str, int, list[str]]] = []
    small = large = 0
    for gene_set in request.gene_sets:
        members = background.intersection(m.root for m in gene_set.members)
        if len(members) < request.min_size:
            small += 1
        elif len(members) > request.max_size:
            large += 1
        else:
            tested.append((gene_set.id, gene_set.name, len(members), sorted(members & hits)))
    if not tested:
        raise ComputeError(
            "no_sets_tested",
            "min_size",
            f"No gene set has between {request.min_size} and {request.max_size} measured members.",
        )

    p_values = [hypergeom_sf(len(overlap) - 1, big_n, size, n) for _, _, size, overlap in tested]
    adjusted = fdr(p_values, "bh")
    terms = [
        Term(
            id=set_id,
            name=name,
            size=size,
            overlap=len(overlap),
            expected=n * size / big_n,
            fold_enrichment=(len(overlap) / n) / (size / big_n),
            p_value=min(1.0, p),
            adj_p_value=min(1.0, adj),
            genes=overlap,
        )
        for (set_id, name, size, overlap), p, adj in zip(tested, p_values, adjusted, strict=True)
    ]
    terms.sort(key=lambda t: (t.p_value, t.id))
    return EnrichmentResult(
        terms=terms,
        n_hits=n,
        n_background=big_n,
        tested=len(tested),
        excluded_small=small,
        excluded_large=large,
        method="hypergeometric (one-sided), over-representation analysis",
        adj_method="BH",
        compute_version=COMPUTE_VERSION,
    )
