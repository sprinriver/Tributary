# tributary-sdk (Python)

A small, dependency-free client for the Tributary API, for notebooks and scripts.

```bash
pip install ./packages/sdk-python      # or the wheel from the release
```

```python
from tributary_sdk import Client
client = Client("https://tributary.example.com/api", token="trb_...")   # a personal access token
for e in client.list_experiments():
    print(e["name"])
rows = client.run_query({"source": {"kind": "sample", "scope": {}}, "page": {"size": 25}})["rows"]
```

- Every call runs with the token owner's permissions; queries are QuerySpecs (copy one from the Explorer's
  "Copy as code"), never SQL.
- `verify_webhook(secret, header, body)` checks the `X-Tributary-Signature` of run-status webhooks.
- Examples: `examples/notebook_quickstart.py`, `examples/webhook_receiver.py`.
- Tests live in `apps/compute/tests/test_sdk.py` (`pnpm run test:compute -k API_0`).
