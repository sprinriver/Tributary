"""Fixed catalogue for the synthetic corpus: public proteins, demo programs, compounds, experiment plan.

Real proteins use public UniProt accessions (https://www.uniprot.org) and HGNC gene symbols. Synthetic
proteins use `SYNP*` accessions and `SYNTH*` gene names, which do not exist in UniProt or HGNC.
No client data is used.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Protein:
    accessions: tuple[str, ...]
    genes: tuple[str, ...]
    names: tuple[str, ...]
    description: str
    family: str
    location: str


def _p(acc: str, gene: str, name: str, description: str, family: str, location: str) -> Protein:
    return Protein((acc,), (gene,), (name,), description, family, location)


REAL_PROTEINS: tuple[Protein, ...] = (
    _p("P04637", "TP53", "P53_HUMAN", "Cellular tumor antigen p53", "transcription factor", "nucleus"),
    _p("P00533", "EGFR", "EGFR_HUMAN", "Epidermal growth factor receptor", "receptor", "cell membrane"),
    _p(
        "P31749", "AKT1", "AKT1_HUMAN", "RAC-alpha serine/threonine-protein kinase", "signalling", "cytoplasm"
    ),
    _p("P01116", "KRAS", "RASK_HUMAN", "GTPase KRas", "signalling", "cell membrane"),
    _p("P15056", "BRAF", "BRAF_HUMAN", "Serine/threonine-protein kinase B-raf", "signalling", "cytoplasm"),
    _p(
        "P60484",
        "PTEN",
        "PTEN_HUMAN",
        "Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase PTEN",
        "enzyme",
        "cytoplasm",
    ),
    _p("P06493", "CDK1", "CDK1_HUMAN", "Cyclin-dependent kinase 1", "cell cycle", "nucleus"),
    _p("P24941", "CDK2", "CDK2_HUMAN", "Cyclin-dependent kinase 2", "cell cycle", "nucleus"),
    _p("P11802", "CDK4", "CDK4_HUMAN", "Cyclin-dependent kinase 4", "cell cycle", "nucleus"),
    _p("Q00534", "CDK6", "CDK6_HUMAN", "Cyclin-dependent kinase 6", "cell cycle", "nucleus"),
    _p(
        "P04626",
        "ERBB2",
        "ERBB2_HUMAN",
        "Receptor tyrosine-protein kinase erbB-2",
        "receptor",
        "cell membrane",
    ),
    _p("P00519", "ABL1", "ABL1_HUMAN", "Tyrosine-protein kinase ABL1", "signalling", "cytoplasm"),
    _p(
        "P12931",
        "SRC",
        "SRC_HUMAN",
        "Proto-oncogene tyrosine-protein kinase Src",
        "signalling",
        "cell membrane",
    ),
    _p("P28482", "MAPK1", "MK01_HUMAN", "Mitogen-activated protein kinase 1", "signalling", "cytoplasm"),
    _p("P27361", "MAPK3", "MK03_HUMAN", "Mitogen-activated protein kinase 3", "signalling", "cytoplasm"),
    _p(
        "Q02750",
        "MAP2K1",
        "MP2K1_HUMAN",
        "Dual specificity mitogen-activated protein kinase kinase 1",
        "signalling",
        "cytoplasm",
    ),
    Protein(
        ("P07900", "P08238"),
        ("HSP90AA1", "HSP90AB1"),
        ("HS90A_HUMAN", "HS90B_HUMAN"),
        "Heat shock protein HSP 90-alpha",
        "chaperone",
        "cytoplasm",
    ),
    _p("P60709", "ACTB", "ACTB_HUMAN", "Actin, cytoplasmic 1", "cytoskeleton", "cytoplasm"),
    _p(
        "P04406",
        "GAPDH",
        "G3P_HUMAN",
        "Glyceraldehyde-3-phosphate dehydrogenase",
        "metabolic enzyme",
        "cytoplasm",
    ),
    _p("P14618", "PKM", "KPYM_HUMAN", "Pyruvate kinase PKM", "metabolic enzyme", "cytoplasm"),
    _p("P06733", "ENO1", "ENOA_HUMAN", "Alpha-enolase", "metabolic enzyme", "cytoplasm"),
    _p("P01106", "MYC", "MYC_HUMAN", "Myc proto-oncogene protein", "transcription factor", "nucleus"),
    _p("P42345", "MTOR", "MTOR_HUMAN", "Serine/threonine-protein kinase mTOR", "signalling", "cytoplasm"),
    _p("O60674", "JAK2", "JAK2_HUMAN", "Tyrosine-protein kinase JAK2", "signalling", "cytoplasm"),
    _p(
        "P40763",
        "STAT3",
        "STAT3_HUMAN",
        "Signal transducer and activator of transcription 3",
        "transcription factor",
        "nucleus",
    ),
    _p("P10415", "BCL2", "BCL2_HUMAN", "Apoptosis regulator Bcl-2", "apoptosis regulator", "mitochondrion"),
    _p(
        "Q07820",
        "MCL1",
        "MCL1_HUMAN",
        "Induced myeloid leukemia cell differentiation protein Mcl-1",
        "apoptosis regulator",
        "mitochondrion",
    ),
    _p("O60885", "BRD4", "BRD4_HUMAN", "Bromodomain-containing protein 4", "epigenetic regulator", "nucleus"),
    _p("P09874", "PARP1", "PARP1_HUMAN", "Poly [ADP-ribose] polymerase 1", "DNA repair", "nucleus"),
    _p(
        "Q15910",
        "EZH2",
        "EZH2_HUMAN",
        "Histone-lysine N-methyltransferase EZH2",
        "epigenetic regulator",
        "nucleus",
    ),
    _p("Q13547", "HDAC1", "HDAC1_HUMAN", "Histone deacetylase 1", "epigenetic regulator", "nucleus"),
    _p("P08670", "VIM", "VIME_HUMAN", "Vimentin", "cytoskeleton", "cytoplasm"),
    _p("P07437", "TUBB", "TBB5_HUMAN", "Tubulin beta chain", "cytoskeleton", "cytoplasm"),
)

N_SYNTHETIC_PROTEINS = 124


def all_proteins() -> list[Protein]:
    synthetic = [
        _p(
            f"SYNP{i:04d}",
            f"SYNTH{i:04d}",
            f"SYNP{i:04d}_SYNTH",
            f"Synthetic protein {i}",
            "synthetic",
            "unknown",
        )
        for i in range(1, N_SYNTHETIC_PROTEINS + 1)
    ]
    return [*REAL_PROTEINS, *synthetic]


PROGRAMS = (
    {
        "code": "ONC",
        "name": "Oncology demo",
        "description": "Synthetic oncology programme for demos and tests.",
    },
    {
        "code": "IMM",
        "name": "Immunology demo",
        "description": "Synthetic immunology programme for demos and tests.",
    },
)

# Simple, valid SMILES of generic aromatic fragments (not marketed drugs). InChIKeys are left empty: computing
# them needs a cheminformatics toolkit, and a made-up key would be wrong data.
COMPOUND_SMILES = (
    "Cc1ccc(NC(=O)c2ccccc2)cc1",
    "O=C(Nc1ccccc1)c1ccncc1",
    "COc1ccc(cc1)S(N)(=O)=O",
    "c1ccc2ncccc2c1",
    "Clc1ccc(cc1)C(=O)N1CCOCC1",
    "OC(=O)c1ccc(cc1)C(F)(F)F",
    "Nc1ncnc2[nH]cnc12",
    "CC(C)Nc1nccc(n1)-c1ccccc1",
)


@dataclass(frozen=True)
class ExperimentPlan:
    key: str
    program_code: str
    assay_type: str
    design: str  # dose_series | contrast | screen
    compound: str | None
    cell_line: str
    experiment_date: str


EXPERIMENTS: tuple[ExperimentPlan, ...] = (
    ExperimentPlan("ONC-DIA-01", "ONC", "proteomics_dia", "dose_series", "CPD-000001", "HeLa", "2026-03-02"),
    ExperimentPlan("ONC-DIA-02", "ONC", "proteomics_dia", "dose_series", "CPD-000002", "A-549", "2026-03-09"),
    ExperimentPlan("IMM-DIA-03", "IMM", "proteomics_dia", "dose_series", "CPD-000003", "K-562", "2026-03-16"),
    ExperimentPlan(
        "IMM-DIA-04", "IMM", "proteomics_dia", "dose_series", "CPD-000004", "HEK293", "2026-03-23"
    ),
    ExperimentPlan("ONC-DIA-05", "ONC", "proteomics_dia", "contrast", "CPD-000005", "MCF-7", "2026-04-06"),
    ExperimentPlan("IMM-DIA-06", "IMM", "proteomics_dia", "contrast", "CPD-000006", "K-562", "2026-04-13"),
    ExperimentPlan("ONC-TMT-07", "ONC", "proteomics_tmt", "contrast", "CPD-000007", "A-549", "2026-05-04"),
    ExperimentPlan("IMM-TMT-08", "IMM", "proteomics_tmt", "contrast", "CPD-000008", "HEK293", "2026-05-11"),
    ExperimentPlan("ONC-RNA-09", "ONC", "rnaseq", "contrast", "CPD-000001", "HeLa", "2026-06-01"),
    ExperimentPlan("IMM-RNA-10", "IMM", "rnaseq", "contrast", "CPD-000003", "K-562", "2026-06-08"),
    ExperimentPlan("ONC-CRI-11", "ONC", "crispr_screen", "screen", None, "A-549", "2026-07-06"),
    ExperimentPlan("IMM-CRI-12", "IMM", "crispr_screen", "screen", None, "K-562", "2026-07-13"),
)

# Dose series: vehicle plus five doses one decade apart, 1 nM to 10 µM (molar value, display text).
DOSES: tuple[tuple[float, str], ...] = (
    (1e-9, "1 nM"),
    (1e-8, "10 nM"),
    (1e-7, "100 nM"),
    (1e-6, "1 µM"),
    (1e-5, "10 µM"),
)

# TMT10plex reporter channels (Thermo Fisher TMT10plex product documentation).
TMT10_CHANNELS = (
    "TMT126",
    "TMT127N",
    "TMT127C",
    "TMT128N",
    "TMT128C",
    "TMT129N",
    "TMT129C",
    "TMT130N",
    "TMT130C",
    "TMT131",
)
