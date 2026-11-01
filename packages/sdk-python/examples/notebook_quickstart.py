"""List your experiments and pull the significant proteins of a differential-abundance release.

    TRIBUTARY_API_URL=http://localhost:5173/api TRIBUTARY_TOKEN=trb_... python notebook_quickstart.py
"""

import os

from tributary_sdk import Client

client = Client(os.environ["TRIBUTARY_API_URL"], token=os.environ["TRIBUTARY_TOKEN"])

for experiment in client.list_experiments():
    print(experiment["name"], experiment["assay_type"])

release = next(
    d["latest_release"]["id"]
    for d in client.list_datasets(kind="differential_abundance")
    if d["latest_release"] and d["latest_release"]["status"] == "published"
)
# log2 fold change = log2(numerator / denominator); adjusted p as stored with the release.
spec = {
    "source": {"releaseIds": [release]},
    "where": {
        "combinator": "and",
        "rules": [
            {"field": "adj_p_value", "operator": "<", "value": 0.05},
            {"field": "log2_fc", "operator": "<", "value": -1},
        ],
    },
    "orderBy": [{"column": "adj_p_value", "dir": "asc"}],
    "page": {"size": 100},
}
for row in client.iter_rows(spec):
    print(row["feature_id"], row["log2_fc"], row["adj_p_value"])
