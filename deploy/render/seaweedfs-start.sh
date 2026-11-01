#!/bin/sh
# The S3 identity comes from the environment; data lives on the mounted disk at /data.
set -eu
: "${S3_ACCESS_KEY_ID:?}" "${S3_SECRET_ACCESS_KEY:?}"
printf '{"identities":[{"name":"tributary","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > /tmp/s3.json
exec weed server -dir=/data -ip.bind=0.0.0.0 -volume.max=200 -master.volumeSizeLimitMB=256 \
  -s3 -s3.port="${PORT:-8333}" -s3.config=/tmp/s3.json
