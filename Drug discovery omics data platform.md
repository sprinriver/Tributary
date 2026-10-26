# Rebuild proteomics-first inside each customer's cloud

No commercial or open-source product reproduces the experiment data application Spring & River built for its biotech client, and that gap is the opportunity. LatchBio, Illumina BioInsight, DNAnexus, Seqera and Code Ocean each cover part of the old app's workflow: a registry, versioned manifests, one-click Nextflow runs, a filter-and-join explorer and twelve Plotly chart types. None is proteomics-first, and the two products that install into a customer's AWS account (Code Ocean and Quilt) lack a serious explorer. The rebuild should keep that feature set nearly intact and replace most of the stack beneath it. Postgres with full-text search, pgvector and lineage tables takes over from OpenSearch and Neptune. Apache Iceberg tables in Amazon S3 Tables, queried by DuckDB from Node, take over from Redshift and lakeFS. ECS Fargate replaces EKS, and a Fastify/TypeScript API with standard OIDC sign-in sits in front of an internal Python/R statistics service. lakeFS must go regardless: **it moved to the Business Source License at v1.87.0 in September 2026, and its README claims that feeding its code to an AI agent violates the licence**. More than a dozen other copyleft, source-available, non-commercial, proprietary or unlicensed components must also stay out of the codebase. The biggest gains are scientific rather than visual: an SDRF-shaped sample manifest validated against ontologies, with typed treatments; data kept at precursor, protein and PTM-site levels; one differential-results schema that records why values are missing; dose-response fits stored as first-class records; and validation at every boundary, which also removes the old app's main class of bugs. AI belongs in the product as governed tools rather than as an autonomous analyst, because **the best agents complete only about a third to two-thirds of realistic omics tasks**. That means named, validated operations exposed in the app and over MCP, run with the signed-in user's permissions and requiring human approval for every write. They should run by default on Amazon Bedrock in the customer's account, even though Anthropic's relaxed biology safeguards are unavailable there. Spring & River can differentiate on proteomics depth, joins between omics hits and compound data, installation in the customer's own account at a price small biotechs can afford, and governance designed for AI agents. Claude Code can build the product in phases sized to one session each, driven by spec, plan and progress files. Hooks and permission rules enforce tests-first work, pinned dependencies and a clean-room boundary around both the client's original code and restrictively licensed sources.

## Five platforms cover parts of the old app, and none leads with proteomics

The old app runs one loop: register an experiment with searchable custom metadata, version its sample manifest, launch Nextflow with one click, then filter, join, chart and export the results. No product reproduces all of it. LatchBio comes closest overall. Its Registry links sample sheets to analyses, and it adds Nextflow and SDK workflows plus reactive Plots ([Latch wiki](https://wiki.latch.bio/wiki/introduction)). Illumina BioInsight Platform Core, the renamed Illumina Connected Analytics, combines Projects and Samples with its Flow, Base, Bench and Cohorts modules ([Illumina docs](https://help.connected.illumina.com/connected-analytics)). DNAnexus pairs its Titan platform with the Apollo Cohort Browser ([DNAnexus docs](https://documentation.dnanexus.com/user/cohort-browser)). Seqera Platform leads on pipeline launch, versioned samplesheets and lineage for each object, but its Data Explorer browses and previews files rather than filtering and joining tables ([Seqera docs](https://docs.seqera.io/platform-cloud/data/data-explorer)). Code Ocean offers admin-defined metadata keys, Nextflow on AWS Batch and a lineage graph that exports to OpenLineage ([Code Ocean lineage](https://codeocean.com/product/lineage-graph)). Narrower products each match one feature well. Genestack ODM has an ontology-bound registry, Benchling does filter-join-chart work on structured results, Quilt keeps a versioned data lake in the customer's account, and Mass Dynamics serves mass-spectrometry (MS) proteomics to biologists.

| Product | Closest overlap with the old app | Main gap | Runs in customer's cloud |
|---|---|---|---|
| LatchBio | Registry tables, Nextflow plus Python SDK, reactive Plots including volcano and heatmap | Deployment model, versioning and lineage not verified | Not verified |
| Seqera Platform | Nextflow-native launch, version-controlled datasets, lineage labels | No filter/join explorer; SSO, audit and VPC hosting only in Enterprise | Enterprise edition, self-hosted in own VPC |
| Code Ocean | Custom metadata keys, Nextflow on AWS Batch, lineage graph | No table explorer found; charts only through Shiny or Streamlit apps | Installs in customer's AWS |
| Illumina BioInsight Platform Core | Projects/Samples, Flow (DRAGEN, Nextflow, CWL), Base, Cohorts | Built around sequencing; proteomics via SomaScan | Bring-your-own S3 bucket |
| DNAnexus Titan + Apollo | Cohort Browser filters, several cohorts per dashboard, export | Needs an Apollo licence; quote-only pricing | Vendor-run private or multi-cloud |
| Genestack ODM | Ontology-bound templates validated on both UI and API imports; cross-study queries over the data itself | Calls itself "not a data analysis software per se"; no native charts | SaaS, VPC or on-prem |
| Benchling Insights/Analysis | Joins, pivots, computed columns, SQL dashboards | About 1,000 points rendered per block; 50,000-row source tables; no omics pipelines | SaaS only |
| Quilt | Immutable packages in customer S3; packages Nextflow outputs; MCP server | Open-source edition lacks hosted search and visualization | CloudFormation in customer's AWS |
| Mass Dynamics | Imports Thermo raw files, MaxQuant and DIA-NN output; limma statistics; volcano and violin plots | SaaS; no join explorer found | Not verified |

Three gaps stand out. **MS proteomics is a secondary data type almost everywhere.** Among the products reviewed, only three handle it in depth: Mass Dynamics, a small SaaS; Genedata Expressionist; and Protein Metrics, now part of Siemens-owned Dotmatics ([IntuitionLabs](https://intuitionlabs.ai/articles/dotmatics-platform-ai-integration-lab-informatics)). Illumina's proteomics strategy centres on the SomaScan affinity assay, which it acquired with SomaLogic in January 2026 for **$350M plus up to $75M in milestones** ([Nasdaq](https://www.nasdaq.com/press-release/illumina-completes-acquisition-somalogic-2026-01-30)).

The second gap is that the products that install in the customer's account are infrastructure tools. Code Ocean "installs directly into your AWS account in about 40 minutes" ([Code Ocean](https://codeocean.com/product)), and Quilt runs as a CloudFormation stack at **$2.60 per container-hour for up to five users** ([AWS Marketplace](https://aws.amazon.com/marketplace/pp/B07QF1VXFQ)). Neither offers the old app's filter-join-chart workbench.

Third, the research found **no platform that joins proteomics differential-abundance results to compound, ADME and kinase tables** as the old app does. Chemistry platforms such as CDD Vault, Revvity Signals and Dotmatics remain a separate product family from omics platforms. That conclusion rests on not finding such a product in limited searches, so it is an absence of evidence rather than proof.

Where the leaders overlap, they converge on patterns worth copying:

- **Typed hierarchy with ontology-bound templates.** Data sits in a hierarchy of projects, experiments, samples and files. Templates bind metadata fields to ontologies and validate UI edits and API imports the same way. Genestack preloads NCBI Taxonomy, UBERON, Cell Ontology, Cellosaurus and ChEBI ([Genestack ODM](https://genestack.com/products/open-data-manager/)).
- **Versioned packages, lineage and roles.** Dataset packages are versioned and cannot change once published. Each object's lineage runs from inputs through pipeline runs to outputs. Roles are scoped to projects, with SSO, SCIM and exportable audit logs.
- **Saved views with parameters.** Examples are DNAnexus cohorts and Benchling dashboards whose `{{parameter}}` filters apply across blocks ([Benchling Insights help](https://help.benchling.com/hc/en-us/articles/9684256342925)). They let scientists return to a slice of data.
- **Methods text, cost controls and assistants.** Pluto attaches an auto-updating methods section to every analysis ([Pluto](https://try.pluto.bio/multi-omics)). DNAnexus lets admins cap spend per project ([G-Cloud](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/252143557680187)). Since 2025, nearly every vendor has added a natural-language assistant and an MCP endpoint.

### Documented complaints map onto what a rebuild can fix

Reviews and vendor documentation record limits that a rebuild can design away. Benchling Insights renders **about 1,000 data points per block** ([Benchling Insights help](https://help.benchling.com/hc/en-us/articles/9684256342925)). Benchling Analysis caps source tables at **50,000 rows** and CSV uploads at 150 MB ([Benchling Analysis help](https://help.benchling.com/hc/en-us/articles/32198112176909)). A CDD Vault reviewer complains that "we can't change anything" on its graphs ([Capterra](https://www.capterra.com/p/171280/CDD-Vault/)). Onboarding is heavy at the enterprise end. Genestack advises customers to appoint dedicated data managers and runs each deployment through a proof of concept and a gap analysis, with further development "on a services basis" ([Genestack ODM](https://genestack.com/products/open-data-manager/)). Governance features sit behind price tiers. Seqera reserves SSO, audit logging and self-hosting in the customer's VPC for its Enterprise plan, and caps its free tier at three users and 250 runs ([Seqera pricing](https://seqera.io/pricing)). DNAnexus's listing on G-Cloud, the UK government's procurement marketplace, offers no free trial and 0% volume discounts ([G-Cloud](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/252143557680187)).

Pricing follows three models:

- **Published usage rates.** Seqera charges $0.10 per CPU-hour ([Seqera pricing](https://seqera.io/pricing)). Illumina sells credits at $1 each and gives new customers 100 free credits for 30 days ([Illumina modules](https://www.illumina.com/products/by-type/informatics-products/connected-analytics/modules.html)).
- **Enterprise contracts quoted individually.**
- **SaaS priced per seat.**

The enterprise end depends on services, from Genestack's services-based development to Elucidata's managed "Data Concierge" ([Elucidata](https://www.elucidata.io/discovery)). That supports a product sold and delivered by a consultancy. Elucidata is the closest model for what Spring & River would become: a consultancy that also sells a platform, whose $16M Series A is listed in Indian startup databases ([Inc42](https://inc42.com/company/elucidata/funding/)).

### Big buyers consolidate while incumbents court small biotechs with free tiers

Large buyers have absorbed informatics vendors. Danaher acquired Genedata in 2024 ([Genedata](https://www.genedata.com/company/news/details/press-release/genedata-joins-danaher-corporation)). Siemens completed its **$5.1B** purchase of Dotmatics in July 2025 ([Manufacturing Chemist](https://manufacturingchemist.com/siemens-completes-acquisition-of-dotmatics)). OpenAI bought Orchestra Bio on 20 October 2026 to extend its Rosalind life-sciences suite ([Unite.AI](https://unite.ai/openai-acquires-orchestra-bio-to-expand-rosalind-life-sciences-tools)).

Some offerings are retreating. AWS closed its HealthOmics variant and annotation stores to new customers on 7 November 2025 ([AWS docs](https://docs.aws.amazon.com/omics/latest/dev/variant-store-availability-change.html)), and TileDB rebranded as Tile.ai, now pitching to enterprise AI buyers ([Dealroom](https://dealroom.co/news/151263-tiledb-rebrands-as-tile-ai-taps-ex-merck-cio-as-chief-executive/)).

Meanwhile, incumbents are courting small biotechs with free or guided entry offers: Revvity's Signals for Startups ([Revvity](https://news.revvity.com/press-announcements/press-releases/press-release-details/2026/Revvity-Launches-Signals-for-Startups-to-Help-Emerging-Biotechs-Build-Scalable-Digital-Foundations-from-Day-One-2026-LcWtOo8Cc9/default.aspx)), Seqera's free Academic Program ([PricingSaaS](https://pricingsaas.com/companies/seqera)) and Illumina's free credits. This comes as budgets tighten: Massachusetts life-sciences firms cut **more than 4,600 jobs in 2025** ([Boston Business Journal](https://www.bizjournals.com/boston/news/2025/12/31/boston-biotech-2025-layoffs.html)).

Two consequences follow. First, instrument makers and industrial companies now own much of this software and sell it bundled with their own products, which makes a vendor-neutral product built on open formats easier to sell. Second, free entry tiers limit what a newcomer can charge small biotechs.

### Open source supplies parts, and 2026 licence changes cut both ways

No open-source platform covers the loop end to end. A few permissively licensed, actively maintained projects serve as references and sometimes as code:

- **Galaxy** is MIT-licensed across its entire codebase as of 25 February 2026 ([Galaxy LICENSE](https://github.com/galaxyproject/galaxy/blob/HEAD/LICENSE.txt)).
- **cBioPortal** is Apache-2.0 only from its October 2026 releases; earlier releases are AGPL-3.0 ([cBioPortal README](https://github.com/cBioPortal/cbioportal/blob/HEAD/README.md)). It still tells new deployments to stay on v6 until v7 stabilises ([cBioPortal versioning](https://github.com/cBioPortal/cbioportal/blob/master/docs/Versioning-and-Upgrades.md)).
- **SEEK (BSD-3), SODAR (MIT) and Quilt (Apache-2.0)** model study design, links between files and metadata, and versioned packages ([SODAR README](https://github.com/bihealth/sodar-server/blob/main/README.rst)). Quilt's open edition omits the hosted search and visualization ([Quilt README](https://github.com/quiltdata/quilt/blob/HEAD/README.md)).

Pipeline monitoring must be rebuilt from scratch. The open-source nf-tower is archived ([nf-tower README](https://github.com/seqeralabs/nf-tower/blob/HEAD/README.md)), and Nextflow removed its nf-weblog status hook in version 26.09.0-edge ([Nextflow CHANGELOG](https://github.com/nextflow-io/nextflow/blob/HEAD/CHANGELOG.md)).

The proteomics pipeline layer shifted in 2026, and the rebuild should target where it is now:

- **quantms moved.** The nf-core quantms repository is archived; development continues at **bigbio/quantms** (MIT). Since version 1.8.0 it accepts only SDRF input and no longer runs MSstats. Since 1.9.0 it publishes **QPX Parquet** tables plus a MuData container instead of mzTab ([quantms CHANGELOG](https://github.com/bigbio/quantms/blob/master/CHANGELOG.md)). Data-independent acquisition (DIA) moved to a separate DIA-NN-based pipeline, quantmsdiann ([quantms README](https://github.com/bigbio/quantms/blob/master/README.md)).
- **QPX (Apache-2.0)** converts DIA-NN, MaxQuant, Spectronaut, FragPipe and OpenMS output into one Parquet schema ([QPX README](https://github.com/bigbio/qpx/blob/main/README.md)). That makes it the natural internal format for cleaned proteomics data.
- **nf-core/differentialabundance** reached v2.0.0 in May 2026, adding DREAM mixed models and formula-based contrasts ([differentialabundance CHANGELOG](https://github.com/nf-core/differentialabundance/blob/master/CHANGELOG.md)).
- **CurveCurator (Apache-2.0)** supplies dose-response fitting ([CurveCurator LICENSE](https://github.com/kusterlab/curve_curator/blob/HEAD/LICENSE)).
- **DIA-NN itself is proprietary.** Its free Academia edition is restricted to non-profit research, so drug-discovery customers need DIA-NN Enterprise ([DIA-NN README](https://github.com/vdemichev/DiaNN/blob/HEAD/README.md)). The platform should import DIA-NN output rather than ship the engine.

Every front-end component the old UI used remains permissively licensed:

- **Plotly.js** is at 4.1.2 (October 2026). Its 4.0 release changed colour parsing and removed the mapbox traces, so a migration pass is needed ([Plotly CHANGELOG](https://github.com/plotly/plotly.js/blob/HEAD/CHANGELOG.md)).
- **react-plotly.js** resumed releases in 2026 after nearly four years without one, now with ES modules and TypeScript types ([react-plotly.js CHANGELOG](https://github.com/plotly/react-plotly.js/blob/HEAD/CHANGELOG.md)).
- **Dash Bio** (MIT, last released in 2022) has the cleanest parameter design for volcano, Manhattan and clustergram views. Its arguments for threshold lines, standardisation, distance and linkage double as the input-validation spec the old app lacked ([Dash Bio clustergram](https://github.com/plotly/dash-bio/blob/master/dash_bio/component_factory/_clustergram.py)).
- **react-querybuilder**'s default operators cover the old filter builder, with `beginsWith` replacing `startswith` ([react-querybuilder defaults](https://github.com/react-querybuilder/react-querybuilder/blob/main/packages/core/src/defaults.ts)).
- **AG Grid Community (MIT)** handles sorting, filtering, pagination, server-side data, cell editing and CSV export. Clipboard, range selection, grouping, pivoting and Excel export stay in the paid Enterprise edition ([AG Grid README](https://github.com/ag-grid/ag-grid/blob/HEAD/README.md)).

The register below lists what must never enter the codebase. Studying these tools' behaviour and UI is fine; copying or translating their code is not. Counsel should confirm each rule.

| Component | Licence status, Oct 2026 | Rule for the rebuild |
|---|---|---|
| lakeFS ≥ 1.87.0 | BUSL-1.1: production use only unmodified and for internal purposes; no offering to third parties ([LICENSE](https://github.com/treeverse/lakeFS/blob/HEAD/LICENSE)). The README says sharing its code with an AI agent violates the licence ([README](https://github.com/treeverse/lakeFS/blob/HEAD/README.md)) | Replace it. Never host it for a client. Never put its source in a Claude Code workspace |
| cBioPortal releases before Oct 2026 | AGPL-3.0 ([README](https://github.com/cBioPortal/cbioportal/blob/HEAD/README.md)) | Copy only from releases after the licence change |
| Omics Playground | Non-commercial (CC BY-NC-ND) or a paid commercial licence; the licence explicitly covers "professional consulting" ([LICENSE](https://github.com/bigomics/omicsplayground/blob/HEAD/LICENSE.md)) | Study only |
| Arvados core, Metabase, eLabFTW, UpSet.js | AGPL-3.0 ([Arvados](https://github.com/arvados/arvados/blob/HEAD/COPYING); [Metabase](https://github.com/metabase/metabase/blob/HEAD/LICENSE.txt); [eLabFTW](https://github.com/elabftw/elabftw/blob/master/LICENSE)); UpSet.js also sold commercially ([UpSet.js](https://github.com/upsetjs/upsetjs/blob/main/LICENSE.md)) | Study only. Build UpSet-style overlap charts from Plotly bars |
| MultiQC, limma, DEqMS, FragPipe GPL components | GPL-3.0 ([MultiQC](https://github.com/MultiQC/MultiQC/blob/HEAD/LICENSE)), GPL ≥ 2 ([limma](https://github.com/bioc/limma/blob/devel/DESCRIPTION)), LGPL, GPL/LGPL ([FragPipe](https://github.com/Nesvilab/FragPipe/blob/master/FRAGPIPE-THIRD-PARTY-LICENSES.txt)) | Run as separate pipeline processes and read their output files. Use MIT-licensed pmultiqc for QC |
| SDRF specification repository | GPL-2.0 ([LICENSE](https://github.com/bigbio/proteomics-sample-metadata/blob/master/LICENSE)) | Implement from the spec text. Use the Apache-2.0 sdrf-pipelines and sdrf-templates |
| ISA-API | CPAL-1.0, with attribution and network-use terms ([LICENSE](https://github.com/ISA-tools/isa-api/blob/HEAD/LICENSE.txt)) | Write ISA-Tab export from the specification |
| Soda Core v4; OpenMetadata ingestion | Elastic License 2.0 ([Soda](https://github.com/sodadata/soda-core/blob/HEAD/LICENSE)); Collate Community License ([OpenMetadata](https://github.com/open-metadata/OpenMetadata/blob/HEAD/ingestion/LICENSE)) | Use datacontract-cli (MIT), Pandera (MIT) or Great Expectations (Apache-2.0) |
| DIA-NN, Spectronaut, MaxQuant | Proprietary | Import their output. Customers bring their own engine licences |
| MinIO Community Edition; LocalStack Hobby | MinIO CE unmaintained and AGPL ([MinIO](https://raw.githubusercontent.com/minio/minio/master/README.md)); LocalStack Hobby non-commercial only ([LocalStack](https://raw.githubusercontent.com/localstack/localstack/main/README.md)) | Use SeaweedFS for local S3 and Iceberg |
| InCHlib.js | No licence file ([README](https://github.com/skutac/InCHlib.js/blob/HEAD/README.md)) | Avoid |

## Scientists need precursor-level data, typed designs and curve fits, not just matrices

### Proteomics moved to DIA, Parquet output and missing-value-aware statistics

Discovery proteomics now relies mostly on label-free DIA processed with DIA-NN or Spectronaut, with isobaric TMT labelling for multiplexed designs. In a head-to-head test on an Orbitrap Astral, DIA quantified **over 11,000 proteins** against 10,325 for TMTpro 18-plex. Protein-level relative standard deviation was 7% for DIA (11% with FAIMS) and 5% for TMT. The authors recommend TMT for relative quantification across many conditions and DIA for broad coverage across many samples ([bioRxiv](https://www.biorxiv.org/content/10.1101/2024.12.17.628765.full.pdf)).

Output formats have changed under users' feet. DIA-NN moved from a version 1 `Report.tsv` to a version 2 `Report.parquet` ([limpa vignette](https://bioconductor.org/packages/release/bioc/vignettes/limpa/inst/doc/limpa.html)). Spectronaut moved from TSV to Parquet with renamed columns. In one documented case its export used decimal commas that had to be converted ([msqrob2 vignette](https://bioconductor.statistik.tu-dortmund.de/packages/3.23/bioc/vignettes/msqrob2/inst/doc/staesSpikein-spectronaut.html)).

Current statistical methods start from precursors with q-values, not from protein matrices. The platform must therefore store three data levels: precursor and peptide tables in long format, protein-group and gene-group matrices, and PTM-site tables. Every derived table should record:

- the processing engine and its version;
- the spectral library type and the FASTA release;
- the q-value filters applied;
- the normalisation and summarisation methods.

The old app's "species spectral library" field should become a full search-space record covering organism, FASTA source and how the library was built.

Sample identity has to come from the platform. DIA-NN reports only `Run` and `Channel` ([DIA-NN README](https://github.com/vdemichev/DiaNN/blob/HEAD/README.md)), and AlphaDIA, FragPipe and MaxQuant expose only run or experiment names. Only Spectronaut carries condition and replicate in its report ([MSstatsConvert](https://github.com/Vitek-Lab/MSstatsConvert/blob/HEAD/R/clean_Spectronaut.R)). The manifest is therefore the source of truth. On demand, the platform converts it into each tool's input:

- SDRF for quantms;
- an observations sheet and contrasts for differentialabundance;
- an MSstats annotation;
- CurveCurator's TOML parameter file;
- nf-core samplesheets.

**Missing values are the central statistical problem.** They "can impact up to 50% of the data matrix". Most are thought to be missing because the protein is low in abundance, not at random. And "the wrong choice of imputation method can lead to false conclusions" ([Wryk et al., IJMS 2024](https://www.mdpi.com/1422-0067/25/24/13491)). The Bioconductor package limpa avoids imputation by modelling the probability that a protein is detected, and reports `PropObs` and `NPrec` beside limma's standard columns ([limpa vignette](https://bioconductor.org/packages/release/bioc/vignettes/limpa/inst/doc/limpa.html)). MSstats reports `issue`, `MissingPercentage` and `ImputationPercentage` ([MSstats groupComparison](https://github.com/Vitek-Lab/MSstats/blob/HEAD/man/groupComparison.Rd)).

The rebuild needs **one standard schema for differential results**. Its columns are:

- feature and feature level, and contrast;
- log2 fold change with confidence limits, standard error and degrees of freedom;
- test statistic and its type;
- p-value, adjusted p-value and the adjustment method;
- observed counts per group;
- issue flags.

Adapters for limma/limpa, MSstats, DEqMS, msqrob2, DESeq2 and MAGeCK fill this schema while keeping every original column.

The confidence intervals the old app displayed must be requested explicitly, because the nf-core limma module defaults to `confint = FALSE` ([limma_de.R](https://github.com/nf-core/modules/blob/master/modules/nf-core/limma/differential/templates/limma_de.R)). Fold-change thresholds also need a policy, because the tools disagree. limma's documentation warns that combining fold-change and p-value cutoffs can push the false discovery rate above its nominal level ([limma topTable](https://rdrr.io/bioc/limma/man/toptable.html)). DIA-NN recommends building fold-change thresholds into the test itself ([DIA-NN README](https://github.com/vdemichev/DiaNN)). The platform should support both approaches and record which one was used.

### Dose-response, thermal profiling and chemistry joins turn hits into decisions

Dose-resolved proteomics carries the most value for drug discovery, and it produces data at large scale:

- **decryptM** measured **about 1.8 million dose-response curves** across 31 cancer drugs and 13 cell lines ([SUFE abstract mirror](https://academicnewsletter.sufe.edu.cn/info/257111)).
- **CurveCurator** fits four-parameter log-logistic curves. It scores each curve with a recalibrated F-statistic, a relevance score and a false discovery rate estimated from decoy curves. It processes large datasets "in a matter of minutes" and has been applied to 379,324 cell-viability curves and 54,223 Kinobeads curves ([CurveCurator](https://pmc.ncbi.nlm.nih.gov/articles/PMC10689459/)).
- **MSstatsResponse** adds isotonic fits with bootstrapped IC50 intervals. It still parses drug and dose out of text labels such as `Dasatinib_003uM` ([MSstatsResponse manual](https://bioc.r-universe.dev/MSstatsResponse/doc/manual.html)).
- **Thermal proteome profiling (TPP)** adds temperature as a design axis. It produces melting curves, potency curves and 2D grids of concentration by temperature. It also surfaces off-targets that matter for safety, such as alectinib and vemurafenib binding the enzyme ferrochelatase ([Proteome Science](https://proteomesci.biomedcentral.com/track/pdf/10.1186/s12953-017-0122-4.pdf)).

Each fit should therefore be a stored record, keyed by feature, compound batch, cell line and time point. The record holds the model, pEC50 with its interval, slope, plateaus, curve fold change, significance, relevance score, q-value, regulation class, the raw dose points in molar units, and the run parameters. The server filters these records, and the browser draws individual curves on demand.

Joins to chemistry should follow public conventions so internal and public data line up. ChEMBL normalises potency to pChEMBL, the negative log of the molar IC50, EC50, Ki or Kd. It separates binding, functional, ADME, toxicity and physicochemical assays, and de-duplicates compounds by standard InChI ([ChEMBL FAQ](https://chembl.gitbook.io/chembl-interface-documentation/frequently-asked-questions/chembl-data-questions)). KLIFS defines an aligned 85-residue kinase binding pocket with annotated hinge and DFG regions ([TeachOpenCADD](https://projects.volkamerlab.org/teachopencadd/talktorials/T025_kinase_similarity_kissim.html)). Kinobeads profiling of 1,183 compounds produced 500,000 compound–target interactions ([TUM portal](https://portal.fis.tum.de/de/publications/chemical-proteomics-reveals-the-target-landscape-of-1000-kinase-i/)).

Proteomics protein groups arrive as semicolon-separated lists of accessions ([quantms.io DE format](https://quantmsio.readthedocs.io/en/latest/de.html)), so a join takes five steps:

1. Split each group into its accessions.
2. Choose a leading accession and flag the group when that choice is ambiguous.
3. Map accessions to genes and targets through versioned UniProt and Ensembl releases.
4. Link the contrast's treatment to that compound's known targets. The treatment must always be a compound batch ID, never a free-text label.
5. Classify each hit as a known target, a known off-target or novel, and show that on the volcano plot and heatmap.

This turns the old app's compound, ADME and hinge-motif joins into a general feature that no competitor was found to offer.

### Genomics splits into a small interactive tier and a large archive

Raw sequencing data is large and rarely reread. A 30× genome produces 100–200 GB of FASTQ and 80–100 GB of BAM, and converting BAM to CRAM shrinks aligned files by roughly 40–70% ([Lab Manager](https://www.labmanager.com/how-big-is-ngs-data-sizing-storage-for-your-sequencing-volume-35842)). A single-cell h5ad object runs 200–500 MB per 10,000 cells ([seqtec](https://seqtec.readthedocs.io/en/latest/data-formats/h5ad-anndata.html)).

The interactive tier is small: gene counts and TPM, differential tables, MAGeCK screen summaries, filtered variants, copy-number calls, and single-cell metadata and embeddings. FASTQ, BAM/CRAM, raw MS files and full single-cell matrices belong in archive storage under lifecycle policies.

The small tables still need cleaning when they are loaded. DESeq2 sets `pvalue` to NA for outliers flagged by Cook's distance, and `padj` to NA for genes removed by independent filtering ([DESeq2 results()](https://rdocumentation.org/packages/DESeq2/topics/results)). The UI should therefore say why a value is missing rather than show a blank. MAGeCK column names such as `neg|p-value` break SQL identifiers ([MAGeCKFlute vignette](https://bioconductor.statistik.tu-dortmund.de/packages/3.11/bioc/vignettes/MAGeCKFlute/inst/doc/MAGeCKFlute.html)), so screen tables need reshaping to long format, keeping the original names.

### SDRF covers samples and files, leaving treatments and contrasts to the platform

SDRF-Proteomics is the de facto metadata standard for proteomics. It has been an official Proteomics Standards Initiative specification since 24 May 2023 ([PSI SDRF](https://www.psidev.info/sdrf-sample-data-relationship-format)). Each row links a sample to a data file or label channel through `characteristics[...]`, `comment[...]` and `factor value[...]` columns. The values "not available" and "not applicable" are reserved for missing entries ([SDRF format docs](https://proteomics-sample-metadata.readthedocs.io/en/latest/sdrf.html)).

The in-progress version 1.1.0 makes `comment[technical replicate]` required and adds layered templates for DIA, cell lines, single-cell and affinity proteomics. It still defines no compound, dose or time columns, and recommends a treatment field only for plants ([SDRF CHANGELOG](https://raw.githubusercontent.com/bigbio/proteomics-sample-metadata/master/CHANGELOG.md)). The standard also explicitly excludes analysis design, such as which samples to compare and which thresholds to apply ([SDRF introduction](https://proteomics-sample-metadata.readthedocs.io/en/latest/introduction.html)).

The manifest should therefore be a typed superset of SDRF, with three additions:

- **Treatment fields backed by ontologies:** compound batch; dose and exposure time with units normalised to molar; vehicle and control flags; biological versus technical replicate; plate and well; TMT channel; fraction; and temperature.
- **A separate, versioned analysis-design record** for contrasts, fit settings, thresholds and method versions.
- **A file model that handles bundles**, so that a Sciex `.wiff` plus `.wiff.scan` pair, or a Bruker `.d` directory, counts as one file.

Validation runs twice. A fast JSON Schema check runs in the browser during inline editing. The Apache-2.0 sdrf-pipelines validator, with its layered and versioned templates, acts as the final authority ([sdrf-pipelines](https://pypi.org/project/sdrf-pipelines/0.1.6/)). Ontology terms resolve through EBI's OLS4, which is Apache-2.0, can be self-hosted on PostgreSQL with pgvector, and exposes an MCP endpoint ([OLS4 README](https://github.com/EBISPOT/ols4/blob/HEAD/README.md)). For non-proteomics studies, ISA-Tab's `Factor Value`, `Unit` and `Term Source REF` conventions set the export format ([ISA-Tab spec](https://isa-specs.readthedocs.io/en/latest/isatab.html)).

The resulting clean-room data model is compact:

- A **Program** contains **Experiments**, each with a stable URN.
- Each Experiment has **ExperimentVersions** that freeze on publish. A new version starts as a copy of the previous version's manifest rows.
- Each version holds **Sample** rows for biological characteristics, **Run/DataFile** rows for path, checksum, fraction, label channel and well, and **AssayRows** that join the two and carry factor values.
- **CustomMetadataKey** definitions give every custom field a datatype, scope, ontology binding, unit, required flag, semantic-search flag and JSON Schema.
- **Contrast**, **DoseResponseDesign** and versioned **TemplateVersion** records complete the model.

### The standard analysis catalogue is wider than twelve charts

The old app's twelve chart types remain necessary: line, bar, 2D and 3D scatter, box/violin, histogram/KDE, lollipop, volcano, bubble, heatmap, dendrogram and pie/donut. Tool documentation shows a wider standard set. No survey ranks how often each view is used, so the catalogue below is inferred from that documentation.

| Data type | Views scientists expect | Where the computation runs |
|---|---|---|
| Proteomics QC | Identifications per run at 1% FDR, completeness and missingness heatmaps, coefficient of variation per condition, intensity distributions, detection-probability curve, sample correlation, PCA/MDS ([limpa](https://bioconductor.org/packages/release/bioc/vignettes/limpa/inst/doc/limpa.html)) | Aggregated on the server, rendered in the browser |
| Proteomics differential abundance | Volcano with a fixed or curved significance boundary, MA plot, ranked fold changes with confidence intervals, per-protein plots that mark imputed points, clustered heatmap of top hits | R/Python workers (limma, limpa, MSstats, msqrob2) |
| Dose-response and TPP | Curve with raw points and fit, pEC50 with interval, potency-versus-effect scatter, melting curves with ΔTm, 2D-TPP heatmap ([CurveCurator](https://pmc.ncbi.nlm.nih.gov/articles/PMC10689459/)) | CurveCurator, MSstatsResponse and TPP in workers; curves drawn on demand |
| Sequencing and CRISPR screens | MA, volcano, PCA, sample-distance heatmap; CRISPR rank and nine-square plots, with mapping, Gini-index and zero-count QC ([MAGeCKFlute](https://bioconductor.statistik.tu-dortmund.de/packages/3.11/bioc/vignettes/MAGeCKFlute/inst/doc/MAGeCKFlute.html)); UMAP and marker dot plots | DESeq2, MAGeCK and Scanpy in pipelines |
| Cross-cutting | Enrichment plots, kinome-style compound–target heatmaps, hits overlaid with known targets, UpSet-style overlaps between contrasts ([differentialabundance](https://github.com/nf-core/differentialabundance/blob/master/docs/output.md)) | Enrichment in workers; joins in DuckDB |

Anything that fits models, or whose cost grows faster than its input, belongs on the server. That covers differential testing, curve fitting with false-discovery control, imputation and normalisation, clustering with bootstrap, PCA or UMAP beyond a few thousand features, and enrichment. The reference implementations are Bioconductor packages and Scanpy, and volumes reach millions of curves. The browser renders precomputed results, using WebGL for volcano and MA plots with 10,000 to 100,000 points.

Every plot should be saved as a reproducible spec: dataset version, filters and parameters. Every plot should also refuse to render when its inputs break basic rules:

- a logarithm of zero or negative values without an explicit offset;
- p-values outside (0, 1];
- clustering distances that cannot handle missing values;
- too few points in a group;
- inconsistent dose units;
- fewer than four dose levels for a four-parameter fit.

### The documented pain is silos, standards and validation, not missing charts

The Pistoia Alliance's Lab of the Future 2025 survey of more than 200 experts ranked **data silos as the top challenge, at 57%**. **49% said they most need help with data standards and ontologies** to make data FAIR. Already, 81% use electronic lab notebooks and 80% use cloud data platforms ([IPT Online](https://www.iptonline.com/articles/pistoia-alliance-more-than-three-quarters-of-life-sciences-labs-expect-to-use-ai-within-two-years)).

Automation pays off sharply. PRIDE's automatic dataset validation cut the average time to an accession number **from 34 hours to 4 minutes** ([PRIDE 2025 update](https://academic.oup.com/nar/article/53/D1/D543/7874848)). Proteomics vendors frame the problem the same way. Paradigm4 targets "preparing datasets for analysis, manually curating identities, and limits to the number of samples that can be compared" ([Paradigm4](https://paradigm4.com/newsevent/paradigm4-launches-reveal-proteomics-to-transform-the-search-for-protein-isoform-biomarkers)).

Scale rules out curating by hand. More than 10% of PRIDE's 42,036 datasets contain over 100 raw files, and the largest holds 7,444 ([PRIDE 2025 update](https://academic.oup.com/nar/article/53/D1/D543/7874848)). Manifest editing therefore needs bulk fill-down, find-and-replace and paste, not just row-by-row edits.

The research found no omics-specific measure of time lost to data wrangling. The familiar figure of about 45% of time spent on data preparation comes from a general 2020 data-science survey ([Datanami](https://careers.hpcwire.com/2020/07/06/data-prep-still-dominates-data-scientists-time-survey-finds/)).

The positioning lesson is direct. The largest need the survey recorded was help with standards and ontologies. Curated templates and ontology pickers, which spare scientists from becoming ontology experts, answer it.

## Agents solve a third to two-thirds of omics tasks, so guardrails are the product

### Every incumbent shipped an assistant, and most shipped an MCP server

By October 2026, most R&D data vendors had shipped two things. The first is an assistant that works over their own governed data. The second is an MCP server through which Claude, ChatGPT or customers' own agents can query that data with the user's permissions. The tasks these assistants automate are consistent: natural-language search and Q&A, turning questions into queries, importing unstructured files, drafting reports with lineage, and configuring and launching pipelines. The guardrails differ, and write actions are where the risk sits.

| Vendor | What the AI does | Status, Oct 2026 | Guardrail worth copying |
|---|---|---|---|
| Benchling | Search and Q&A, SQL Writer, CRO-report import, drafting, Data Analysis skill; MCP server | Shipped; MCP server out of beta in April 2026 ([Benchling](https://www.benchling.com/news/benchling-launches-ai-connectors-to-power-data-ecosystem)) | Queries run as the signed-in user, inside existing audit trails ([Benchling Help](https://help.benchling.com/hc/en-us/articles/40342713479437)) |
| Dotmatics Luma Agent | Questions over Luma data, R-group analysis, write-ups with full material lineage, configuring apps and data models | Shipped May 2026; switched on per customer instance | "Every write operation requires explicit human approval" ([Dotmatics](https://www.dotmatics.com/blog/luma-agent-your-ai-co-scientist)) |
| Seqera | Pipeline generation and debugging; launch and monitor through MCP; self-hosted Co-Scientist built on FastAPI and LangGraph | Shipped; Enterprise 26.2 ([Seqera docs](https://docs.seqera.io/platform-enterprise/enterprise/install-seqera-ai)) | Uses the signed-in user's token, not a shared admin token; recommends Bedrock |
| Revvity Signals AI | Search, interpretation and actions; connector listed in Anthropic's directory | Partly available, June–July 2026 ([Business Wire](https://businesswire.com/news/home/20260622242972/en/Revvity-Launches-Signals-AI-a-Native-Agentic-Framework-for-Accelerating-Scientific-RD)) | Claims grounding in ontologies and validated algorithms |
| DNAnexus | Omics Data Agent for building cohorts without code | Announced May 2026; only ingestion described as live ([01net](https://www.01net.it/dnanexus-scales-ai-driven-capabilities/)) | Not described |
| Snowflake Intelligence; Databricks Genie | Natural-language questions turned into SQL over governed warehouses | Snowflake generally available since November 2025 ([Snowflake](https://www.snowflake.com/en/news/press-releases/snowflake-intelligence-brings-agentic-AI-to-the-enterprise/)) | Semantic model and verified queries; each end user's permissions enforced in the data layer |

Industry leaders disagree on how far agents can go. Benchling's head of AI predicts that agents will handle 75% of data-analysis tasks in biology within a year ([SynBioBeta](https://www.synbiobeta.com/read/benchling-launches-three-products-during-synbiobeta-2026-%E2%80%94-and-its-head-of-ai-hints-at-what-comes-next)). Genestack's CEO warns that "an agent will confidently work for hours or days and produce wrong answers against ungoverned data". His company is building "a small, deliberate catalogue of named operations" behind MCP, with first customer deployments promised in the months after June 2026 ([Genestack blog](https://genestack.com/news/blog/pharma-data-fabric-for-ai-agents/)).

Rival model vendors gate access in different ways. OpenAI's GPT-Rosalind requires a trusted-access review ([R&D World](https://www.rdworldonline.com/openai-research-and-product-leads-detail-gpt-rosalind-capabilities-and-benchmarks/)). Microsoft Discovery reached general availability on 2 June 2026 ([Azure blog](https://azure.microsoft.com/en-us/blog/announcing-microsoft-discovery-general-availability-and-microsoft-discovery-app-preview/)).

### Benchmarks and failure modes argue for constrained tools

Independent evaluations favour constrained tools:

- **OmicsBench (Latch):** the best of 31 combinations of model and agent harness scored **49.4% on short-horizon and 32.8% on long-horizon omics tasks** ([Latch](https://latch.bio/sdk)).
- **BixBench:** Phylo, which sells the Biomni Lab agent, reports 52.2% for Biomni Lab and 39.5% for Claude Code on Opus 4.6 across the full set. The scores rise to 88.7% and 65.3% on an expert-verified 50-question subset, created after Phylo found ambiguous questions and wrong answer keys in the original ([Phylo](https://phylo.bio/blog/evaluating-ai-agents-in-biology)).
- **BiomedSQL:** the best agent reached 62.6% execution accuracy, against 90% for experts. It failed most often on implied thresholds such as p < 5e-8, and on knowing when to decline to answer ([BiomedSQL](https://arxiv.org/html/2505.20321v1)).
- **Spider 2.0:** on enterprise database schemas, often with more than 1,000 columns, the best agent solved 21.3% of tasks ([alphaXiv](https://www.alphaxiv.org/abs/2411.07763v2)).

The failures are the dangerous kind:

- analyses that "look polished" while swapping up- and down-regulated genes ([Phylo](https://phylo.bio/blog/evaluating-ai-agents-in-biology));
- language-model setups without tools that decline to answer only 1.8% of the time, yet give the most wrong answers ([Medea](https://www.biorxiv.org/content/10.64898/2026.01.16.696667.full.pdf));
- findings that are "statistically significant yet scientifically irrelevant" ([Edison](https://edisonscientific.com/news/announcing-kosmos)).

Constraint works. Snowflake's Cortex Analyst puts a semantic model and a library of verified queries in front of SQL generation, rejects ambiguous questions and repairs SQL using compiler errors; Snowflake claims over 90% accuracy ([Snowflake](https://snowflake.com/engineering-blog/snowflake-cortex-analyst-behind-the-scenes)). The ARMS metadata-curation agent must look up ontology terms and may not invent values. On 839 legacy HuBMAP records it raised **precision from 0.56 to 0.93**, and recall from 0.51 to 0.85, compared with the same model prompted without tools. Its errors shifted from wrong substitutions to cautious omissions ([ARMS](https://arxiv.org/pdf/2604.08552)).

The rebuild should copy that discipline:

- **Queries.** The assistant writes the platform's own filter-and-join language as JSON validated against a schema. That language supports =, !=, >, >=, <, <= and starts-with, plus inner, left and right joins. The server compiles it into parameterised SQL that runs on read-only views.
- **Charts.** The assistant emits chart specs validated against a schema, never plotting code.
- **Domain conventions.** FDR cutoffs, fold-change thresholds, missing-value filters and minimum replicate counts belong in a semantic layer, not in the model's head.
- **Search.** Hybrid search must apply the same permission and tenancy filters to every sub-query ([DigitalOcean OpenSearch docs](https://docs.digitalocean.com/products/vector-databases/opensearch/concepts/hybrid-search/)). It must also keep a strong keyword component, because vector search matches URNs, sample IDs, wells and compound IDs poorly ([ParadeDB](https://paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)).

Security follows the same logic:

- **The "lethal trifecta".** No detection-based defence reliably stops an agent that combines private data, untrusted content and a way to send data out ([Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)). An assistant that reads CRO PDFs must therefore not also have open outbound network access.
- **Tokens.** The MCP specification says servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server" ([MCP security](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices)).
- **Sandboxing.** Analysis that executes code belongs in sandboxes that drop all Linux capabilities, mount a read-only filesystem, disable networking and route traffic through a proxy that injects credentials, so "the agent never sees the actual credentials" ([Anthropic secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)). AWS AgentCore Runtime is a managed alternative that isolates each session in its own microVM for up to eight hours ([AWS AgentCore FAQ](https://aws.amazon.com/bedrock/agentcore/faqs/)).

### Anthropic's ecosystem helps distribution but restricts biology use inside the customer's cloud

Anthropic's life-sciences push opens a distribution channel:

- **October 2025:** Claude for Life Sciences launched with Benchling, 10x Genomics and PubMed connectors, and an Agent Skill for single-cell RNA-seq QC ([Anthropic](https://www.anthropic.com/news/claude-for-life-sciences?lang=us)).
- **January 2026:** ChEMBL, Open Targets and ToolUniverse connectors arrived, along with skills for converting instrument data to the Allotrope format and for deploying Nextflow ([Anthropic](https://anthropic.com/news/healthcare-life-sciences)).
- **June 2026:** Claude Science entered beta on 30 June. It ships connectors to public databases including UniProt, PRIDE and OLS ([Claude Science docs](https://claude.com/docs/claude-science/connectors-and-skills)). For every figure it attaches the exact code, environment, a plain-language note and the message history, which a reviewer agent checks ([The Next Web](https://thenextweb.com/news/anthropic-claude-science-ai-workbench-scientists)).

Tooling for public databases is therefore a commodity. The defensible asset is governed access to private experiment data. Spring & River can offer it as a remote MCP connector, as Benchling and Revvity have done, plus Agent Skills that encode lab procedures such as "QC a protein-group matrix". Claude Science's provenance package also sets the bar for any chart the platform's AI produces.

**The constraint is Anthropic's biology safeguards.** Anthropic's generally available models "include safeguards that block some biology requests, which can interrupt work such as target discovery, molecular design, clinical development, and manufacturing" ([Claude Help Center](https://support.claude.com/en/articles/16975617)). Opus 5.5 uses the same biology safeguards as Fable 5.1 ([HLTH](https://hlth.com/insights/news/anthropic-launches-claude-opus-5-5-with-expanded-biology-capabilities)). The Life Sciences Verification Program, in beta since 17 September 2026 ([Unite.AI](https://www.unite.ai/ja/anthropic-launches-life-sciences-verification-program-in-beta/)), relaxes these safeguards for verified organisations. But it works **only on Claude Enterprise, Team and Anthropic's own API, not on Amazon Bedrock, and not for "platforms passing access through to their own customers"**. It also keeps data for 30 days, with no zero-data-retention option ([Claude Help Center](https://support.claude.com/en/articles/16975617)).

Bedrock remains the strongest way to keep data in the customer's account. AWS states that Bedrock does not store or log prompts or use them for training ([Simon Willison quoting AWS](https://simonwillison.net/2024/Dec/5/amazon-bedrock-data-protection/)), and model providers cannot see customer prompts ([AWS Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html)). The product should:

- default to Bedrock in the customer's account;
- make every core feature work under the default safeguards;
- handle refusals gracefully;
- let a customer that holds its own verification grant point the assistant at its own Anthropic workspace. That arrangement still needs confirming with Anthropic.

Three Anthropic API features are not eligible for zero data retention: code execution (container data is kept for up to 30 days), the Files API and the MCP connector ([Anthropic ZDR](https://platform.claude.com/docs/en/build-with-claude/zero-data-retention)). The MCP connector also needs a public HTTPS endpoint and is not offered on Bedrock ([MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)). Private data inside the customer's network should therefore be reached through tools the platform runs itself.

Prompts about kinase-inhibitor design and target discovery are the likeliest to trip the safeguards. That has not been tested and belongs in an early technical spike.

### Pharma buyers expect six controls, and regulation mostly stops short of discovery

Procurement expectations have converged on six controls:

1. A contractual commitment not to train on customer data.
2. Explicit retention windows.
3. Inference inside the customer's cloud boundary.
4. The user's own permissions applied to every AI query. As Databricks puts it, "Unity Catalog, not the model, is the security boundary" ([Databricks](https://www.databricks.com/blog/how-ground-genie-agents-both-structured-data-and-documents-without-losing-governance)).
5. Audit trails of AI actions.
6. Human approval for writes.

Formal regulation mostly does not reach discovery work:

- FDA's January 2025 draft guidance on using AI for regulatory decisions excludes drug discovery from its scope ([Hogan Lovells](https://hlc.com/en/publications/fda-unveils-longawaited-guidance-on-ai-use-to-support-drug-and-biologic-development)).
- The draft EU GMP Annex 22 bars generative AI from critical manufacturing (GMP) uses; its final text is targeted for Q4 2026 ([PharmTech](https://www.pharmtech.com/view/europe-tried-to-ban-generative-ai-from-critical-gmp-the-ban-may-not-survive-it-does-not-matter-)).
- FDA reads 21 CFR Part 11, its electronic-records rule, narrowly: it covers records that other rules, such as GLP, require ([FDA](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/part-11-electronic-records-electronic-signatures-scope-and-application)).
- ISPE's GAMP guide for AI, published in October 2025, supplies the vocabulary that buyers' QA teams will use ([ISPE](https://ispe.org/news/ispe-releases-gampr-guide-artificial-intelligence)).

The defensible position is "non-GxP decision support with GAMP-aligned controls": a product built to be ready for Part 11 without claiming it has been validated. In practice that means published versions that cannot change, an audit trail that records the reason for each change, synchronised timestamps, and a publish step that can carry an electronic signature. Outputs that feed IND-enabling GLP studies need the whole workflow qualified.

## Keep the features, collapse the stack onto Postgres, Iceberg and Fargate

The architecture is Node-first, not Node-only. The front end is a single-page app on Vite 8 ([Vite](https://registry.npmjs.org/vite)) and React 19, with TanStack Router and TanStack Query; because users sign in through SSO, it needs no server-side rendering. One Fastify 5 API generates an OpenAPI 3.1 spec from zod 4 schemas, so TypeScript and Python clients share the same contracts ([Fastify](https://registry.npmjs.org/fastify); [zod-to-openapi](https://registry.npmjs.org/@asteasolutions/zod-to-openapi)). A separate DuckDB query service keeps the memory spikes of analytical queries away from request handling, and an internal Python/R service runs the statistics. A pnpm and Turborepo monorepo holds a shared package of contracts for manifests, filter trees and chart specs. Terraform deploys a separate single-tenant copy into each customer's AWS account.

| Old app component | New design | Why |
|---|---|---|
| FastAPI microservices for auth, admin, metadata access and data access | One Fastify API, one DuckDB query service, one internal Python/R compute service | Fewer deployables; one set of contracts across UI, API and workers |
| Okta | OIDC handled by the backend (`openid-client`), project roles enforced with CASL, optional SCIM | Each customer brings Okta, Entra ID, Auth0 or Keycloak |
| Postgres | Postgres on RDS as the system of record, with Kysely 0.29 and SQL migrations | Typed dynamic SQL for the filter builder |
| OpenSearch | Postgres full-text search plus pgvector HNSW indexes with iterative scans | Removes an OpenSearch Serverless cost floor of about $175–350 a month |
| Neptune | Lineage node and edge tables shaped like OpenLineage, queried recursively | Lineage graphs are shallow at this scale |
| Redshift gold layer | Iceberg tables in S3 Tables, queried by DuckDB; Athena for analysts | A warehouse pays off only with many concurrent BI users |
| lakeFS | Postgres experiment versions, S3 Versioning and Iceberg snapshots | Licence; one fewer service |
| EKS | ECS Fargate through Terraform; EKS and Helm only if a customer requires Kubernetes | No cluster to operate |
| Nextflow on AWS Batch with status | `PipelineRunner` interface with HealthOmics and Batch adapters; EventBridge to SQS, plus polling | nf-weblog is gone; region coverage differs |
| RabbitMQ, Glue crawlers, Lambda crons | pg-boss on Postgres; S3 Tables' Glue integration; pg-boss cron or EventBridge Scheduler | Fewer moving parts |
| Plotly charts (12 types) | Plotly.js 4.1 and react-plotly.js 4.1, loaded lazily as partial bundles | Same charts without a rewrite |

Contracts make validation structural, which removes the old app's main class of bugs. Two kinds of contract do the work:

- **zod schemas** in the shared package drive validation in the grid, request checks in the API and the generated OpenAPI spec.
- **Open Data Contract Standard (ODCS) v3.2 contracts** describe each gold table: its schema, keys, units and quality rules, such as finite fold changes and p within (0, 1]. The `datacontract-cli` tool offers `test` and `breaking` commands, for checking tables after each run and contracts in CI ([datacontract-cli](https://pypi.org/pypi/datacontract-cli/json)). It was not verified whether it reads Iceberg tables in S3 directly, so Pandera in the Python worker is the fallback.

Ingest becomes an explicit state machine: uploaded, type detected, contract validated, QC passed or failed, then published or rejected. Each transition writes an audit row, and a failed QC disables the pipeline button. The `file-type` library detects only binary formats, not text formats such as CSV ([file-type](https://registry.npmjs.org/file-type)), so FASTQ, VCF, CSV and TSV files need small custom detectors.

### Versions become data instead of lakeFS commits

lakeFS cannot carry over:

- Version 1.87.0 "changes lakeFS's license from Apache 2.0 to the Business Source License 1.1" and removes pluggable IAM ([lakeFS CHANGELOG](https://github.com/treeverse/lakeFS/blob/HEAD/CHANGELOG.md)).
- The licence allows production use only of unmodified software, only for internal purposes, and forbids offering its functionality to third parties ([lakeFS LICENSE](https://github.com/treeverse/lakeFS/blob/HEAD/LICENSE)).
- The README treats sharing its source with an AI agent, without the required notices, as a violation ([lakeFS README](https://github.com/treeverse/lakeFS/blob/HEAD/README.md)).
- Its Iceberg REST catalog is a private preview on paid tiers only ([lakeFS Iceberg docs](https://docs.lakefs.io/iceberg/)).
- The Team edition is capped at five users and 500 GB ([lakeFS editions](https://docs.lakefs.io/editions/)).

The replacement is simpler:

- **Postgres** holds experiments, frozen experiment versions, file objects (bucket, key, S3 version ID and SHA-256 checksum), pipeline runs, dataset releases (each a table plus an Iceberg snapshot ID) and the audit log.
- **Raw files** sit in an S3 bucket with versioning switched on.
- **Gold tables** are append-only Iceberg tables in S3 Tables, partitioned by experiment version. They hold protein-group matrices in long format, differential abundance, dose-response, and compound and ADME data.

Returning to an earlier version then becomes a `WHERE experiment_version_id = …` filter, which never depends on how long snapshots are kept. That matters, because S3 Tables keeps snapshots for only 120 hours by default. **Adding your own Iceberg tags or branches also switches off S3 Tables' automatic snapshot management for the whole table** ([AWS S3 Tables maintenance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-maintenance.html)). Snapshots stay useful for undoing a bad publish.

DuckLake is the alternative when one release must update several tables in a single atomic transaction. It keeps its catalog in Postgres and supports transactions across tables ([MotherDuck](https://motherduck.com/blog/announcing-ducklake-1-0-on-motherduck.md)). However, no evidence was found that Athena or Redshift can read it.

### DuckDB serves the explorer from Node

DuckDB 2.0.0 LTS shipped on 21 October 2026, with asynchronous I/O for Parquet on S3 and support until at least October 2027. Support for 1.4 LTS ends on 17 November 2026 ([DuckDB](https://duckdb.org/2026/10/21/announcing-duckdb-200)). The `@duckdb/node-api` client wraps the released binaries and streams results using promises. The legacy `duckdb` npm package stops at 1.4.4 ([npm](https://registry.npmjs.org/duckdb)).

The speed gain is real but only partly measured. In a cold read from S3, from a laptop over home internet, a 2.0 pre-release read one column of a 2.2 GB, 228-million-row Parquet file in 7.7 seconds, against 18.8 for version 1.5.5 ([MotherDuck](https://motherduck.com/blog/why-duckdb-20-is-faster/)). Latency inside an AWS region, over Iceberg, after filtering down to one experiment, has not been measured and must be benchmarked before committing. The Iceberg extension is still labelled experimental ([duckdb-iceberg](https://github.com/duckdb/duckdb-iceberg/blob/HEAD/README.md)), although it documents INSERT, UPDATE, DELETE and MERGE against catalogs that include S3 Tables ([DuckDB docs](https://duckdb.org/docs/2.0/core_extensions/iceberg/writing_to_iceberg.html)). Writes can therefore go through pyiceberg in the Python worker instead.

Each explorer query passes through four steps:

1. The server checks the react-querybuilder JSON against each dataset's allowed columns and their types.
2. It compiles the query to parameterised SQL.
3. It permits joins only on keys declared in the dataset contract.
4. It returns results as JSON pages of 100–1,000 rows.

Large chart payloads go out as Parquet files behind presigned URLs, which the browser reads with `hyparquet` or `parquet-wasm`, because the Node client's Arrow APIs are incomplete ([DuckDB Node docs](https://duckdb.org/docs/2.0/clients/node_neo/overview.html)). DuckDB versions must be pinned identically in Node and Python, since database files written by 2.0 cannot be read by older versions. Production should wait for a 2.0.x patch release. Athena reaches the same tables through S3 Tables' integration with the Glue catalog ([AWS docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-tables.html)). Redshift earns its place only for customers with many BI users querying at once.

### Postgres takes over search and lineage

Postgres on RDS takes over what OpenSearch and Neptune did. Custom keys live in JSONB, validated against their definitions. A generated `tsvector` column handles keyword search, and pgvector HNSW indexes cover fields flagged for semantic search.

One pgvector behaviour matters for permissions. Filters apply after the approximate index scan, so with the default `hnsw.ef_search` of 40, a filter that matches 10% of rows returns only about four results unless iterative index scans are enabled ([pgvector README](https://raw.githubusercontent.com/pgvector/pgvector/master/README.md)). Postgres's built-in full-text ranking also lacks statistics across the whole corpus. Reciprocal rank fusion, which merges the keyword and vector result lists, compensates for this ([ParadeDB](https://paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)). The licence of ParadeDB's own BM25 extension was not checked.

A small or mid-size biotech is assumed to hold thousands of experiments, not millions. At that scale, OpenSearch Serverless's minimum cost of about $175 a month for development and $350 for production does not pay off ([CloudBurn](https://cloudburn.io/blog/amazon-opensearch-pricing)).

Lineage becomes node and edge tables traversed with recursive SQL, with run records shaped like OpenLineage run events ([OpenLineage spec](https://github.com/OpenLineage/OpenLineage/blob/main/spec/OpenLineage.json)). Marquez, the reference OpenLineage server, has not had a release since October 2024 ([Marquez CHANGELOG](https://github.com/MarquezProject/marquez/blob/HEAD/CHANGELOG.md)), so it should be an optional export target, not a dependency. For database access, Kysely suits translating a dynamic filter tree into SQL ([Kysely](https://registry.npmjs.org/kysely)). By contrast, Prisma's CLI `latest` tag points at an 8.0 release candidate ([Prisma](https://registry.npmjs.org/prisma)), and Drizzle 1.0 is still a release candidate ([Drizzle](https://registry.npmjs.org/drizzle-orm)).

### Node orchestrates while R and Python do the statistics

JavaScript statistics libraries are too thin for this science. ml-hclust implements only one clustering algorithm, AGNES ([ml-hclust](https://registry.npmjs.org/ml-hclust)), and ml-pca has not been published since 2022 ([ml-pca](https://registry.npmjs.org/ml-pca)). The reference tools (limma, limpa, MSstats, DESeq2, CurveCurator and Scanpy) should run in containerised pipeline steps or workers whose output files Node reads. That also keeps GPL tools such as limma and MultiQC out of the proprietary codebase.

For interactive re-analysis, an internal FastAPI service with a pg-boss worker can use Python ports of these tools, with three caveats:

- inmoose ports limma, edgeR and DESeq2, but it is licensed GPL-3.0-or-later (PyPI `license_expression`, checked 26 Oct 2026), so like limma it may only run as a separate process, never as a library inside the product; its agreement with the R originals is also unverified ([inmoose](https://pypi.org/pypi/inmoose/json)).
- pydeseq2 warns "you may experience some differences" ([pydeseq2](https://pypi.org/pypi/pydeseq2/json)).
- No equivalent of R's pvclust exists on PyPI ([PyPI](https://pypi.org/pypi/pvclust/json)), so bootstrap support for dendrograms needs custom resampling code.

TypeScript handles the light transforms: pseudolog scaling, z-scores, binning, Benjamini–Hochberg correction and error bars. pg-boss replaces RabbitMQ with queues stored in Postgres, offering priorities, retries and dead-letter queues that Python can drive through plain SQL ([pg-boss](https://registry.npmjs.org/pg-boss)). SQS is used only to receive events from AWS.

### Pipelines run through one runner interface with two AWS adapters

One-click launch survives behind a `PipelineRunner` interface with four methods (start, status, cancel and log links) and two AWS adapters.

**AWS HealthOmics** is fully managed and costs nothing when idle. It supports Nextflow 26.04, run caches and EventBridge status events. But it runs in only eight regions, none in India, inside an isolated network that forces pipeline modules to be bundled ([AWS What's New](https://aws.amazon.com/de/about-aws/whats-new/2026/06/aws-healthomics-nextflow-version-26-04/); [AWS docs](https://docs.aws.amazon.com/omics/latest/dev/nextflow-version-release-notes.html)).

**AWS Batch running a Nextflow head job** supports Spot instances, pipelines that need internet access, and regions HealthOmics does not cover, including India. Loka ran the same RNA-seq pipeline on both services. Tuned Batch ran faster at every dataset size and cost **about 44% less on small runs and 19% less on large ones**. But a poorly chosen instance family made Batch up to 74% more expensive, and its proof of concept took at least 50% longer to build ([Loka](https://www.loka.com/blog/aws-healthomics-vs-aws-batch-cost-speed-and-complexity)).

Seqera's launch API can be an optional third adapter for customers who already use Seqera ([Seqera automation docs](https://docs.seqera.io/platform-cloud/getting-started/quickstart-demo/automation)). Spring & River's demo environment should sit in a region that offers HealthOmics.

Status tracking must tolerate lost events, because EventBridge delivery is best-effort ([AWS docs](https://docs.aws.amazon.com/omics/latest/dev/eventbridge.html)) and Batch emits no event for the initial submission ([AWS docs](https://docs.aws.amazon.com/batch/latest/userguide/batch_job_events.html)). The API therefore writes the SUBMITTED status itself. It applies EventBridge events arriving through SQS as idempotent updates, and it polls unfinished runs every few minutes.

The launch button should accept only published dataset versions that passed ingest QC. Completed runs should generate their results dashboards automatically, as Latch does with DESeq2 dashboards built from nf-core runs ([Latch blog](https://blog.latch.bio/p/a-new-visualization-software-for)). Here the chain runs from DIA-NN output, through the protein matrix and limma or limpa, to volcano, heatmap and QC views.

### One tool registry feeds both the in-app assistant and the MCP server

The AI layer rests on one TypeScript tool registry. Every tool declares:

- zod input and output schemas;
- a risk class: read, write or compute;
- the permission it needs;
- limits on how many rows and tokens it can return.

Each handler calls platform services as the end user, never through a shared service account.

Two adapters sit on top of the registry:

- **The in-app assistant** uses either the Vercel AI SDK, whose version 6 added a per-tool `needsApproval` flag ([Vercel](https://vercel.com/blog/ai-sdk-6)), or in-process MCP servers from the Claude Agent SDK, which runs on Bedrock with `CLAUDE_CODE_USE_BEDROCK=1` ([Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart.md)).
- **A remote MCP server** for external assistants uses the stable MCP TypeScript SDK v2. It implements the 2026-07-28 specification and includes middleware for bearer-token auth, OAuth metadata and origin validation ([MCP TS SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)).

Tools return summaries plus result handles that stay on the server and are bound to the user, because the Agent SDK writes any MCP result over 25,000 tokens to a file instead ([Agent SDK MCP docs](https://code.claude.com/docs/de/agent-sdk/mcp)). The first catalogue should be named operations that buyers can audit, such as `get_experiment`, `query_matrix`, `run_differential_abundance`, `fit_dose_response` and `make_volcano`, each writing lineage. Steps that wait on human review, such as a curation queue, fit LangGraph.js. Its `interrupt()` call saves state until a person approves, edits or rejects ([LangChain](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt)).

Anthropic offers no embedding model, and Voyage has no biomedical one ([Anthropic embeddings docs](https://platform.claude.com/docs/en/build-with-claude/embeddings.md)). Deployments that keep all data in the customer's account should start with Amazon Titan Text Embeddings V2. It keeps about 99% of its 1,024-dimension retrieval accuracy at 512 dimensions ([AWS](https://aws.amazon.com/about-aws/whats-new/2024/04/amazon-titan-text-embeddings-v2-amazon-bedrock)). Index ontology IDs, labels and synonyms alongside the raw values, and pick the final model by its recall on a test set built from the platform's own metadata. Branding has rules too: "YourAgentName Powered by Claude" is allowed, but "Claude Code" branding is not ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)).

### A small deployment runs about $430–520 a month before pipeline compute

ECS Fargate with Terraform is the right default for a small team. App Runner closed to new customers on 30 April 2026 ([AWS docs](https://docs.aws.amazon.com/ja_jp/apprunner/latest/dg/apprunner-availability-change.html)), and CDK for Terraform was archived on 10 December 2025 ([CDKTF README](https://raw.githubusercontent.com/hashicorp/terraform-cdk/main/README.md)). EKS's control-plane fee and Kubernetes operations are unjustified for three to six services unless a customer requires Kubernetes. Pharma platform teams expect to review and apply the Terraform themselves. The deployment should ship with SSO-only access, customer-managed KMS keys on S3, S3 Tables and RDS, CloudTrail data events, and a documented RACI (responsibility matrix) for Spring & River's support access.

| Item (us-east-1, one production environment) | Monthly cost |
|---|---|
| Two small API tasks (third-party Fargate unit prices, [Vantage](https://www.vantage.sh/blog/fargate-pricing)) | ~$72 |
| One 4 vCPU / 16 GB query task | ~$170 |
| One worker | ~$43 |
| db.t4g.medium Postgres, single-AZ to Multi-AZ ([Bytebase](https://www.bytebase.com/dbcost/rds/instance/db.t4g.medium/); Multi-AZ assumed at about double) | ~$47–94 |
| Networking | ~$32 |
| 1 TB in S3 Tables at $0.0265 per GB-month ([AWS S3 pricing](https://aws.amazon.com/s3/pricing/)) | ~$29 |
| Load balancer, logs and keys (unverified estimate) | ~$40–80 |
| **Total before pipeline compute** | **~$430–520 on x86; ~$375–465 on Graviton** |

Pipeline compute comes on top: in Loka's test, roughly $16.70 per large RNA-seq run on tuned Batch ([Loka](https://www.loka.com/blog/aws-healthomics-vs-aws-batch-cost-speed-and-complexity)). For local development, SeaweedFS provides S3, table buckets and an Iceberg catalog in one Apache-2.0 process ([SeaweedFS README](https://raw.githubusercontent.com/seaweedfs/seaweedfs/master/README.md)). Cost controls belong in the product from day one. Examples are per-project spend limits that either notify or enforce, as at DNAnexus ([G-Cloud](https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/252143557680187)), and Spot instances with idle shutdown, as at Code Ocean ([Code Ocean](https://codeocean.com/product)).

## Copy the workflows, fix the science, drop restricted code, compete on governance

The findings reduce to a register that can feed a backlog directly. "Copy" means rebuilding a proven behaviour from scratch. It never means copying code from the client's app or from the restricted sources listed earlier.

| Move | Decision | Basis |
|---|---|---|
| **Copy** | The old app's full loop: URN-based registry with versioning, searchable custom keys, manifest upload and editing, one-click Nextflow with status and logs, filter/join explorer with CSV export, and the twelve Plotly chart types with their options (pseudolog, standardisation, error bars, clustering method, distance, bootstrap) | No competitor bundles this loop |
| **Copy** | Templates that bind fields to ontologies, with identical validation for UI edits, CSV upload and API import | Genestack, Code Ocean |
| **Copy** | Saved views: start from all rows, filter, save a named view, compare views; shared parameters across chart blocks; dashboards embedded on the experiment page | DNAnexus cohorts, Benchling Insights |
| **Copy** | Launch from a selection; lineage tags on each file ("produced by run X, used by runs Y and Z"); a project lineage graph with OpenLineage export | Seqera, Code Ocean |
| **Copy** | Auto-generated methods text per analysis; code, environment and history attached to each figure | Pluto, Claude Science |
| **Copy (with attribution)** | Dash Bio's chart factories ported to TypeScript; CELLxGENE-style WebGL selection; Phantasus/Morpheus heatmaps; CurveCurator's linked volcano, potency and curve panels | MIT/BSD/Apache sources |
| **Copy (design only)** | DIA-NN "Analyse" filter expressions, computed columns, missing-value policies and switching between protein, gene and site levels | Proprietary reference |
| **Improve** | Validation at every layer: zod in UI and API, pydantic in workers, ODCS contracts on tables, schema-checked chart specs | Fixes the old app's main class of bugs |
| **Improve** | A typed manifest built as a superset of SDRF, with templates, ontology pickers, reserved missing-value tokens and uniqueness rules; SDRF import and export; bulk fill, replace and paste | Data silos top challenge (57%), standards help needed (49%); PRIDE datasets with 100+ files |
| **Improve** | Three data levels, QPX as the internal cleaned format, and adapters that tolerate engine-version changes and decimal-comma locales | DIA-NN and Spectronaut format changes |
| **Improve** | One differential-results schema with missing-value classes, reason codes for each missing value, and both styles of fold-change threshold | How limpa, MSstats and DESeq2 behave |
| **Improve** | Dose-response, TPP and Kinobeads fits as first-class records, paged on the server | About 1.8M curves in decryptM |
| **Improve** | Versions stored as data in Postgres and Iceberg, shown to users as versioned packages rather than hidden lakeFS commits | Licence; Quilt-style UX |
| **Improve** | Server-side aggregation, columnar transfer and WebGL, to go well beyond Benchling's caps of about 1,000 rendered points and 50,000 rows | Documented scale complaints |
| **Avoid** | lakeFS ≥ 1.87, in the product or in any AI workspace | BUSL-1.1 and the AI-agent clause |
| **Avoid** | Copying or translating code under AGPL, GPL, CPAL or non-commercial licences; run GPL tools as separate processes | Licence register |
| **Avoid** | Bundling DIA-NN, Spectronaut or MaxQuant | Proprietary; DIA-NN Academia is for non-profits only |
| **Avoid** | Iceberg tags or branches on S3 Tables; relying on snapshot retention for business versions | They switch off snapshot management |
| **Avoid** | nf-weblog and nf-tower; App Runner, CDKTF, EKS by default, MinIO CE, LocalStack Hobby, the legacy `duckdb` npm package, Prisma `@latest` | Removed, archived, restricted or pre-release |
| **Avoid** | Agents writing raw SQL or code against raw schemas; the Messages API MCP connector for private data; agent writes without approval; open outbound network access wherever untrusted content is read | Benchmarks; zero-data-retention and Bedrock limits; lethal trifecta |
| **Avoid** | Depending on AG Grid Enterprise features (clipboard, range selection, pivot, Excel export) without a licence; build a dialog for pasting tab-separated data instead | Only Community is MIT |
| **Differentiate** | Proteomics first: native importers from DIA-NN, Spectronaut, MaxQuant, FragPipe and AlphaDIA into QPX; precursor, protein and site levels; mzQC and pmultiqc QC tracked per instrument over time | Incumbents treat proteomics as secondary |
| **Differentiate** | Joins between proteomics and chemistry: compound batches, ChEMBL-style measurements, UniProt and KLIFS targets, overlays of known targets and off-targets | No competitor found doing it |
| **Differentiate** | Installs into the customer's account in a day; open formats; SSO and audit included; a flat platform fee plus the customer's own AWS bill | Seqera's Enterprise-only SSO and audit; Quilt's five-user entry tier |
| **Differentiate** | Ready for agents but deterministic: MCP connector and Agent Skills over named operations, provenance on every figure, a documented evaluation for each feature | Genestack's thesis; benchmark scores of 33–63% |
| **Differentiate** | Neutral and portable, unlike vendors owned by Danaher, Illumina, Revvity or Siemens | Consolidation, 2024–2026 |

The main competitive threats are well funded. LatchBio raised a Series B in April 2026; one aggregator puts it at $130M ([BounceWatch](https://bouncewatch.com/company/latchbio)) while another lists the amount as undisclosed ([Caplight](https://www.caplight.com/company/latchbio)). The others are Benchling's Data Analysis skill, OpenAI's Rosalind Workbench, Illumina's free credits and Connected Multiomics, Revvity's startup programme, and Elucidata's combination of services and platform.

The strongest alternative to building is assembly: Seqera for pipelines, Quilt for versioning and Benchling for records, connected over MCP. That would be faster to stand up. But it stacks three vendors' fees, leaves governance behind enterprise tiers, and still has no proteomics-first explorer. The rebuild's runner adapters and MCP server let it sit alongside those tools rather than compete with them head-on.

The pricing recommendation is an inference, since no data on what small biotechs will pay turned up. A flat platform fee with SSO and audit included, plus the customer's own AWS bill, contrasts directly with Seqera's tier gating and Quilt's five-user entry tier. It also suits budgets squeezed by the 2025 layoffs.

## Claude Code builds it in one-session phases behind deterministic gates

### Clean-room discipline is set up before the first prompt

Clean-room here means two boundaries, and each needs enforcement rather than good intentions.

The first boundary protects the client's original application:

- Start a new repository.
- Keep the client's code, schemas, data, ontology lists, URN namespaces and branding out of every Claude Code workspace.
- Give Claude a generalised feature description written from this report, not from the client's source.

A permission rule such as `Read(//…/client-app/**)` denies file reads using the documented absolute-path syntax. The same documentation warns that rules on Bash commands are not a security boundary ([Permissions docs](https://code.claude.com/docs/en/permissions)), so the sandbox's filesystem deny list must block shell access too. Test fixtures should come from public data. The SDRF rules were validated on more than 256 annotated projects ([SDRF CHANGELOG](https://raw.githubusercontent.com/bigbio/proteomics-sample-metadata/master/CHANGELOG.md)), and decryptM results are public in ProteomicsDB ([TUM Proteomics](https://www.mls.ls.tum.de/proteomics/news/article/new-science-publication-decryptm-is-finally-out)).

The second boundary covers third-party code. Never place lakeFS source in a workspace. Never paste GPL, AGPL, CPAL or non-commercial code into a prompt, or ask Claude to translate it. Keep a licence register with pinned versions in the repository, and run a licence check in CI.

Whether the client contract allows a generalised rebuild at all is a question for counsel before Phase 0.

### Spec, plan and progress files carry state across sessions

Anthropic's documented workflow suits a build lasting months. Claude first interviews the team and writes `docs/SPEC.md`; then, in Anthropic's words, the team should "start a fresh session to execute it". The most useful specs "name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step" ([Best practices](https://code.claude.com/docs/en/best-practices)). A plan-mode session then produces `docs/PLAN.md`, revised until "an engineer who has never seen the conversation could implement the change from the plan alone" ([Anthropic Academy](https://academy.claude.com/courses/ai-native-sdlc-playbook/plan-mode)). Each phase should fit one session and one reviewable pull request: one or two packages, and three to seven checkable definition-of-done items. State lives in `docs/PROGRESS.md`, in git history and in a JSON feature list in which agents may only flip a `passes` field.

Anthropic's research on long-running agents supports this setup ([Anthropic Engineering](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents)):

- The model was "less likely to inappropriately change or overwrite JSON files compared to Markdown files".
- Working "on only one feature at a time" was critical.
- Testing in a browser "as a human user would" dramatically improved results.

That argues for running the Playwright MCP server on every UI phase, with `--isolated` so parallel sessions never share a browser profile ([playwright-mcp](https://github.com/microsoft/playwright-mcp)). The root `CLAUDE.md` should stay under 200 lines and act as an index of commands, non-default conventions and pitfalls. Each package gets its own `CLAUDE.md`, which loads only when Claude works in that package ([Memory docs](https://code.claude.com/docs/en/memory)).

### Hooks and permissions enforce what CLAUDE.md can only request

`CLAUDE.md` is advisory. Anthropic's own guidance is that "a real guardrail needs to be deterministic" ([Anthropic blog](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)). Ways to check that a task is complete grow stronger in four steps: an instruction in the prompt, then `/goal`, then a Stop hook that runs the check script and blocks the turn until it passes, then a reviewer subagent with a fresh context ([Best practices](https://code.claude.com/docs/en/best-practices)).

A practical setup has four parts:

- **Tests first.** Commit the failing acceptance tests before any implementation.
- **A Stop hook** runs `pnpm check`, but only on turns that changed non-test files, and it respects `stop_hook_active`. Stop hooks fire on every response, and Claude Code overrides one after eight blocks in a row ([Hooks guide](https://code.claude.com/docs/en/hooks-guide)).
- **A PreToolUse hook** blocks edits to lockfiles, applied migrations, infrastructure and secrets. Its deny holds even in bypass mode.
- **Narrow permission rules.** Allow only exact script commands. Put `pnpm add` and `uv add` behind "ask". Never allow environment runners such as `npx` or `docker exec`, because a rule for them approves whatever command follows ([Permissions docs](https://code.claude.com/docs/en/permissions)).

The supply-chain risk is concrete. Across 2.23 million code samples from 16 models, **19.7% contained at least one package name that does not exist**, and 43% of those invented names came back on every one of ten reruns ([CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/)). That repeatability lets attackers register the invented names in advance, an attack called slopsquatting. The countermeasures:

- Pin exact dependency versions.
- Protect lockfiles from direct edits.
- Require a written justification for every new dependency.
- Review dependencies in CI.
- Install the TypeScript and Pyright LSP plugins, which flag invented symbols right after each edit ([Code intelligence](https://code.claude.com/docs/en/plugins/code-intelligence)).

Two configuration traps belong in the runbook. Setting `auto` permission mode at project level has no effect ([Settings docs](https://code.claude.com/docs/en/settings)). And `claude -p` without `--bare` runs the project's hooks and MCP servers even in folders that have not been trusted ([Headless docs](https://code.claude.com/docs/en/headless)).

### Parallel work, model choice and budget

Parallel work should wait for a hand-built reference. Build the chart framework with two reference charts: the volcano plot, and the clustered heatmap with dendrogram. Then use `/batch`, which runs 5–30 units of work, each in its own background worktree ([Commands reference](https://code.claude.com/docs/zh-CN/commands)). It can build the remaining chart types and engine adapters against the same structure and tests. Skip the experimental agent teams, which use about seven times the tokens of a standard session in plan mode ([Costs docs](https://code.claude.com/docs/en/costs)).

Anthropic advises Sonnet for most coding and Opus for architecture and multi-step reasoning ([Costs docs](https://code.claude.com/docs/en/costs)). List prices per million input/output tokens are $4/$20 for Opus 5.5, $2/$10 for Sonnet 5.5 and $0.10/$0.50 for Haiku 5.5 ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)). A sensible split:

| Work | Model |
|---|---|
| Spec, plan and architecture decision records | Opus at high effort |
| Routine phases | Sonnet, or `opusplan` (Opus plans, Sonnet executes) |
| Test triage | Haiku |
| Plan reviewer | Opus |

Use `/clear` rather than `/compact` between phases, because quality degrades as the context fills and clearing is free ([Costs docs](https://code.claude.com/docs/en/costs)). Fable's safety classifiers can silently rerun biology-flagged requests on Opus 5 ([Model config](https://code.claude.com/docs/en/model-config)). That should be rare for platform code, but it is worth recognising when it happens.

Enterprise Claude Code use averages **about $13 per developer per active day** ([Costs docs](https://code.claude.com/docs/en/costs)). The phased plan in the build kit comes to about 30–35 sessions over 6–9 weeks, roughly $400–600 at that average and up to about $1,200 with heavy parallel work or Opus-heavy sessions. In CI, `anthropics/claude-code-action@v1` can review pull requests, though commits pushed with the default `GITHUB_TOKEN` do not trigger workflows ([GitHub Actions docs](https://code.claude.com/docs/en/github-actions)).

### Milestones for the phased plan

Each milestone breaks into several session-sized phases in `docs/PLAN.md`. Each phase opens with a commit of failing acceptance tests and closes with evidence anyone can check.

| Milestone | Scope | Proof of done |
|---|---|---|
| M0 Foundation and guardrails | Monorepo, `CLAUDE.md` files, hooks, permissions, CI with licence and dependency review, Docker Compose (Postgres with pgvector, SeaweedFS, Keycloak), `pnpm check`, Playwright smoke test | `pnpm check` passes; smoke-test screenshot; licence report |
| M1 Contracts and schema | zod contracts for manifest, filter tree, chart spec and metadata keys; Kysely migrations for the data model; OpenAPI generation | Contract tests; generated TypeScript and Python clients compile |
| M2 Identity, roles, audit | Backend OIDC sign-in tested against Keycloak; CASL project roles; append-only audit log with reason for change | Tests in which two users with different roles see different results; an audit row for every change |
| M3 Registry, versioning, search | Published versions that cannot change, with new versions cloned from the manifest; custom keys bound to ontologies through OLS4; hybrid search with permission filters | Immutability tests; role-based search tests; end-to-end clone flow |
| M4 Manifest editor and SDRF | Parsing in a web worker, grid editing, bulk fill and paste, inline errors, sdrf-pipelines validation, SDRF import and export | Public SDRF files import and export unchanged; browser and server validators agree |
| M5 Ingest and QC gates | Presigned multipart upload, format detection and checksums, engine adapters into QPX, pmultiqc and mzQC import, ODCS contracts, ingest state machine | Adapter tests on public DIA-NN, Spectronaut and MaxQuant output; failed QC blocks launch |
| M6 Pipeline runner | Batch and HealthOmics adapters, conversion of the manifest into each tool's input format, EventBridge to SQS plus poller, log links | Full small nf-core run in a sandbox account with every status change recorded |
| M7 Gold layer and explorer | S3 Tables gold tables, DuckDB query service, filter/join compiler, pagination, CSV export, saved views | SQL-injection and allowed-column tests; latency benchmark recorded inside an AWS region |
| M8 Chart framework | Chart-spec schema; volcano and heatmap-with-dendrogram reference charts; bootstrap clustering in Python; WebGL; reproducible plot specs | Visual regression tests; invalid-input rejection tests |
| M9 Chart fan-out | Remaining old-app chart types plus MA, PCA/MDS, QC views and UpSet-style bars | Every chart type passes its unit and visual tests |
| M10 Proteomics science layer | Standard differential-results schema and adapters, missing-value classes, dose-response records with a curve viewer, auto-generated methods text | Adapter tests against reference outputs; report comparing R and Python results |
| M11 Chemistry joins and lineage UI | Compound batches, ChEMBL-style measurements, UniProt and KLIFS targets, protein-group splitting, versioned ID mapping; lineage tags and graph | Known-target overlay correct on test data; lineage traversal tests |
| M12 AI layer, read-only | Tool registry; in-app assistant that writes filter queries and chart specs; verified queries; evaluation harness with test questions and role-impersonation tests | Evaluation scores above agreed thresholds; every tool call audited |
| M13 AI layer, governed writes and MCP | Remote MCP server with OAuth 2.1; curation agent with a review queue; approval required for every write; sandboxed analysis jobs | MCP conformance and token-audience tests; no write succeeds without approval |
| M14 Install and hardening | Terraform modules, KMS, CloudTrail data events, backups, spend limits, a publish step that can carry an electronic signature, install runbook | Clean install into a fresh AWS account within one working day; tested restore from backup |

## Conclusion

The rebuild's lasting asset is the governed meaning of its data, not its charts. Plotly, Dash Bio's patterns and Anthropic's public-database connectors have turned visualisation and database lookups into commodities. What remains scarce is typed treatments and contrasts, one result schema per family of analyses with missing values recorded, and a catalogue of validated, named operations. The contracts that fix the old app's validation bugs are the same contracts that make its data safe for agents. The human UI and the MCP server should therefore be two views of one rule set, and the science layer has to come before the AI layer, not after it.

The research also changes how the risks look. Within roughly a year, the old app's versioning layer became source-available with a clause aimed at AI agents, Nextflow dropped its weblog status hook, and AWS closed a managed omics store to new customers. Dependency licences and lifecycles are now inputs to the architecture, and open standards such as Iceberg, OpenLineage, SDRF and MCP are safer bets than any single product.

For Spring & River, the window is real but narrowing. Genestack's catalogue of named operations, Benchling's analysis agent, Latch's funding and OpenAI's Rosalind are all moving toward the same idea: governed data that agents can safely use. The fastest defensible entry point is narrow. It is small-molecule biotechs with heavy proteomics workloads that need DIA results joined to compound data inside their own AWS account, sold as a services-led install with a transparent platform fee.

The questions to settle before Phase 0 are legal and commercial rather than technical:

- whether the client contract permits a generalised rebuild;
- how Anthropic treats a vendor whose customers hold their own verification grants;
- AG Grid Enterprise's terms for embedding it in a resold product;
- what India's Digital Personal Data Protection Act requires when Kolkata staff access customer systems for support;
- whether S3 Tables is available in the regions the first customers choose.
