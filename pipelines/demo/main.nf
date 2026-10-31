// Tiny local test pipeline (CLAUDE.md: pipelines/demo). It "quantifies" by copying fixture outputs that the
// synthetic generator wrote in DIA-NN and limma formats, so the platform's run → outputs → releases path can be
// exercised end to end without real data or containers. Not a scientific workflow.
nextflow.enable.dsl = 2

params.pg_matrix = null
params.toptable = null
params.outdir = 'results'
params.delay_seconds = 0

process DEMO_QUANT {
    publishDir params.outdir, mode: 'copy'

    input:
    path pg_matrix, stageAs: 'in/report.pg_matrix.tsv'
    path toptable, stageAs: 'in/toptable.tsv'

    output:
    path 'report.pg_matrix.tsv'
    path 'toptable.tsv'

    script:
    """
    sleep ${params.delay_seconds as int}
    cp in/report.pg_matrix.tsv report.pg_matrix.tsv
    cp in/toptable.tsv toptable.tsv
    """
}

workflow {
    if (!params.pg_matrix || !params.toptable) error 'Set --pg_matrix and --toptable'
    DEMO_QUANT(file(params.pg_matrix, checkIfExists: true), file(params.toptable, checkIfExists: true))
}
