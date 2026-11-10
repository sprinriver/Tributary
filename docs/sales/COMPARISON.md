# How Tributary compares

Internal note for sales conversations. It compares **categories of tools**, not named products: check a vendor's
current documentation before making any claim about a specific product to a customer.

| Capability | ELNs and compound registries | Hosted omics analysis services | In-house scripts and shared drives | Tributary |
|---|---|---|---|---|
| Where data lives | Vendor cloud, usually | Vendor cloud, usually | Your storage | Your AWS account |
| Experiment and sample registry | Yes, general purpose | Partly | No | Yes, with validated manifests (SDRF-aligned) |
| Proteomics pipelines launched and tracked | Rarely | Yes | Ad hoc | Yes (quantms, quantmsdiann on Batch or HealthOmics) |
| Immutable, versioned result datasets with provenance | Rarely | Varies | No | Yes, enforced by the database |
| Cross-experiment questions (protein or compound across all experiments) | Limited to registered fields | Within one project, usually | Manual | Yes, through one query layer |
| Selectivity from proteome-wide dose-response | No | Rarely | Custom scripts | Yes, with stated caveats |
| Structure search on registered compounds | Yes | No | No | Yes (substructure, similarity) |
| Audit trail and validation support | Yes, in regulated editions | Varies | No | Yes (audit log, validation pack) |
| SSO and SCIM | Yes | Varies | n/a | Yes |
| AI assistant limited to the user's permissions, no SQL from the model | Varies | Varies | n/a | Yes |

## Where Tributary is weaker today
- **Breadth of ELN features:** it is not a notebook. It registers experiments and results; free-form notebook pages,
  inventory and requests are out of scope. Position it next to the ELN, connected to it.
- **Assay types:** proteomics first. RNA-seq and CRISPR tables import as datasets, but have fewer dedicated views.
- **Integrations:** no ELN connector yet; which one to build first depends on what pilot customers use.
- **Proof points:** no customer references, penetration test or SOC 2 report yet.

## Messages that hold up
1. Your proteomics data never leaves your account.
2. Every number on a slide can be traced to a file, a tool version and a person.
3. Scientists answer cross-experiment questions themselves, without waiting for a bioinformatician.
