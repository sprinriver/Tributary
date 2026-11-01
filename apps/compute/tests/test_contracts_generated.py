"""The pydantic models generated from packages/contracts (`pnpm gen`) import and validate."""

import pytest
from pydantic import ValidationError

from tributary_compute.contracts.contract_error import ContractError
from tributary_compute.contracts.query_spec import QuerySpec


def test_CON_03_generated_query_spec_validates() -> None:
    spec = QuerySpec.model_validate(
        {
            "source": {"kind": "differential_abundance", "scope": {}},
            "where": {
                "combinator": "and",
                "rules": [
                    {"field": "adj_p_value", "operator": "<", "value": 0.05},
                    {"combinator": "or", "rules": [{"field": "log2_fc", "operator": ">", "value": 1}]},
                ],
            },
            "page": {"size": 25},
        }
    )
    dumped = spec.model_dump(mode="json", exclude_none=True)
    assert dumped["page"] == {"size": 25}
    assert dumped["where"]["rules"][1]["rules"][0]["field"] == "log2_fc"


def test_CON_03_generated_query_spec_rejects_raw_sql() -> None:
    with pytest.raises(ValidationError):
        QuerySpec.model_validate({"source": {"kind": "protein_quant", "scope": {}}, "sql": "select 1"})


def test_CON_03_generated_contract_error() -> None:
    error = ContractError.model_validate({"code": "required", "field": "rows.0.dose", "message": "Required"})
    assert error.code == "required"
