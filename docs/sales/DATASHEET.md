# Tributary datasheet

**The experiment data platform for drug-discovery proteomics, installed in your own AWS account.**

## What it does
- **Registers experiments** with validated sample sheets (Excel, TSV or SDRF), versions and approvals.
- **Runs pipelines** (quantms, quantmsdiann) on AWS Batch or HealthOmics, and tracks every run.
- **Imports results** from DIA-NN, MaxQuant, FragPipe, limma, MSstats, CurveCurator, DESeq2, MAGeCK and custom
  tables into versioned,
  immutable datasets with recorded provenance.
- **Shows results** as volcano plots, QC panels, heatmaps, PCA and dose-response curves, with a table alternative
  for every chart.
- **Answers discovery questions:**
  - which pathways changed (enrichment, gene–concept network);
  - how selective a compound is and what else it hits (selectivity profile and table);
  - what a protein did in every experiment, with its 3D model;
  - which compounds share a substructure.
- **Supports the team:** hit triage board, watchlists and alerts, Slack, Teams and email notifications, reports as
  PDF or PowerPoint, an AI assistant that acts with the user's own permissions.

## Why teams choose it
| Need | Tributary |
|---|---|
| Data stays with us | Installed in your AWS account. No shared service, and no copy of your data elsewhere. |
| Results we can trust | Published versions cannot change. Every transformation, tool and version is recorded. |
| Audit and compliance | Append-only audit trail, re-authentication on approval, a validation pack (traceability matrix, IQ/OQ templates, 21 CFR Part 11 controls map). Tributary is not a validated system; the pack supports your validation. |
| IT requirements | Single sign-on (OIDC), SCIM provisioning, roles per program, KMS encryption, a strict Content-Security-Policy, rate limiting, an SBOM with every build. |
| Science done right | Statistics run in a tested Python service. Fold changes, adjusted p-values and potencies carry their definitions, and caveats are shown next to the numbers. |
| Open interfaces | REST API with OpenAPI, Python and TypeScript clients, webhooks, and an MCP server for AI tools. |

## Deployment
- **Where:** AWS (ECS Fargate, RDS PostgreSQL, S3, CloudFront), from Terraform modules.
- **Indicative running cost:** about $375–520 a month for one production environment, before pipeline compute
  (see `docs/ARCHITECTURE.md` §12; verify against your region and usage).
- **Support:** a diagnostics bundle without secrets or personal data, so support needs no access to your account.

## Not included today
- Thermal proteome profiling (TPP) views and PTM site-level data.
- ELN connectors and STRING interaction networks.
- An independent penetration test and SOC 2 report.

Contact: (add your contact line)
