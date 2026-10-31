import type { QuerySpec } from '@tributary/contracts';

// SPEC M6 "Copy as code": the same QuerySpec through the public API with a personal access token.

const json = (spec: QuerySpec) => JSON.stringify(spec, null, 2);

export function pythonCode(spec: QuerySpec, apiBase: string): string {
  return `import json
import os

import pandas as pd
import requests

API = "${apiBase}"
headers = {"Authorization": f"Bearer {os.environ['TRIBUTARY_TOKEN']}"}
spec = json.loads(r"""
${json(spec)}
""")

rows, cursor = [], None
while True:
    page = dict(spec, page={"size": 1000, **({"cursor": cursor} if cursor else {})})
    res = requests.post(f"{API}/v1/query", json=page, headers=headers, timeout=60)
    res.raise_for_status()
    body = res.json()
    rows += body["rows"]
    cursor = body["nextCursor"]
    if not cursor:
        break

df = pd.DataFrame(rows)
print(df.head())
`;
}

export function rCode(spec: QuerySpec, apiBase: string): string {
  return `library(httr2)

api <- "${apiBase}"
spec <- jsonlite::fromJSON('${JSON.stringify(spec).replaceAll("'", "\\'")}', simplifyVector = FALSE)

rows <- list()
cursor <- NULL
repeat {
  spec$page <- c(list(size = 1000), if (!is.null(cursor)) list(cursor = cursor))
  body <- httr2::request(paste0(api, "/v1/query")) |>
    req_auth_bearer_token(Sys.getenv("TRIBUTARY_TOKEN")) |>
    req_body_json(spec, auto_unbox = TRUE) |>
    req_perform() |>
    resp_body_json()
  rows <- c(rows, body$rows)
  cursor <- body$nextCursor
  if (is.null(cursor)) break
}

df <- dplyr::bind_rows(rows)
head(df)
`;
}

export const specJson = json;
