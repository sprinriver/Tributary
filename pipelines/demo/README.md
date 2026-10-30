# pipelines/demo

Local test pipeline for the `local` runner (apps/api `pipelines/local.ts`): Nextflow in the
`nextflow/nextflow` Docker image copies the DIA-NN pg_matrix and limma topTable fixtures given as
`--pg_matrix` / `--toptable` to `--outdir`. Run outputs are imported by the pipeline definition's
`output_importers` (`diann_pg_matrix`, `limma_toptable`).
