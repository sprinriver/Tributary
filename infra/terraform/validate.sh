#!/bin/sh
# `pnpm run infra:validate`: format, validate, lint and scan the Terraform. Never plans or applies.
# Tools (installed by the operator or CI, not by tooling here): Terraform >= 1.10 (or OpenTofu), tflint, checkov 3.4.0.
set -eu
cd "$(dirname "$0")"
missing=""
command -v terraform >/dev/null 2>&1 || missing="$missing terraform(>=1.10)"
command -v tflint >/dev/null 2>&1 || missing="$missing tflint(>=0.50)"
command -v checkov >/dev/null 2>&1 || missing="$missing checkov(3.4.0)"
if [ -n "$missing" ]; then
  echo "infra:validate needs:$missing — see docs/DEPLOY.md → Tools. CI runs this in the 'infra' job." >&2
  exit 1
fi
echo "== terraform fmt"
terraform fmt -check -recursive -diff
for env in envs/*/; do
  echo "== terraform validate $env"
  terraform -chdir="$env" init -backend=false -input=false -no-color >/dev/null
  terraform -chdir="$env" validate -no-color
done
echo "== tflint"
tflint --init --config "$PWD/.tflint.hcl" >/dev/null
tflint --recursive --config "$PWD/.tflint.hcl" --format compact
echo "== checkov"
checkov --config-file .checkov.yaml -d .
echo "infra:validate: all checks passed"
