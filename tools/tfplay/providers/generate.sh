#!/usr/bin/env bash
# Regenerates static/tfplay/providers/*.json.gz from the real provider schemas.
#
# Needs network access to releases.hashicorp.com and the Go module proxy.
# The result is committed, so this only has to run when bumping versions.
#
#   AWS_VERSION=6.66.0 RANDOM_VERSION=3.9.1 NULL_VERSION=3.3.2 LOCAL_VERSION=2.9.1 ./generate.sh
set -euo pipefail

TF_VERSION="${TF_VERSION:-1.16.4}"
AWS_VERSION="${AWS_VERSION:-6.66.0}"
RANDOM_VERSION="${RANDOM_VERSION:-3.9.1}"
NULL_VERSION="${NULL_VERSION:-3.3.2}"
LOCAL_VERSION="${LOCAL_VERSION:-2.9.1}"

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$root/static/tfplay/providers"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

os=linux; arch=amd64
mkdir -p "$out" "$work/proj"

curl -sSL -o "$work/tf.zip" "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_${os}_${arch}.zip"
unzip -q -o "$work/tf.zip" -d "$work"

for p in "aws:$AWS_VERSION" "random:$RANDOM_VERSION" "null:$NULL_VERSION" "local:$LOCAL_VERSION"; do
  name="${p%%:*}"; ver="${p##*:}"
  dir="$work/mirror/registry.terraform.io/hashicorp/$name"
  mkdir -p "$dir"
  curl -sSL -o "$dir/terraform-provider-${name}_${ver}_${os}_${arch}.zip" \
    "https://releases.hashicorp.com/terraform-provider-${name}/${ver}/terraform-provider-${name}_${ver}_${os}_${arch}.zip"
done

cat > "$work/cli.tfrc" <<EOF
provider_installation {
  filesystem_mirror { path = "$work/mirror" }
}
EOF
cat > "$work/proj/main.tf" <<EOF
terraform {
  required_providers {
    aws    = { source = "hashicorp/aws", version = "$AWS_VERSION" }
    random = { source = "hashicorp/random", version = "$RANDOM_VERSION" }
    null   = { source = "hashicorp/null", version = "$NULL_VERSION" }
    local  = { source = "hashicorp/local", version = "$LOCAL_VERSION" }
  }
}
EOF
(cd "$work/proj" && TF_CLI_CONFIG_FILE="$work/cli.tfrc" "$work/terraform" init -input=false >/dev/null \
  && TF_CLI_CONFIG_FILE="$work/cli.tfrc" "$work/terraform" providers schema -json > "$work/schema.json")

# Provider source, used to recover ForceNew / Default (not part of the schema JSON).
src_dir="$(cd "$here/.." && go mod download -json "github.com/hashicorp/terraform-provider-aws@v${AWS_VERSION}" 2>/dev/null | sed -n 's/.*"Dir": "\(.*\)".*/\1/p' || true)"
if [ -z "$src_dir" ]; then
  # Tags v6+ are not valid Go module versions; fall back to the main branch.
  src_dir="$(cd "$here/.." && go mod download -json github.com/hashicorp/terraform-provider-aws@main | sed -n 's/.*"Dir": "\(.*\)".*/\1/p')"
fi

cd "$here/.."
go run ./cmd/schemagen -schema "$work/schema.json" -provider registry.terraform.io/hashicorp/aws \
  -name aws -version "$AWS_VERSION" -src "$src_dir" -meta "$here/meta/aws.json" -out "$out/aws.json.gz"
go run ./cmd/schemagen -schema "$work/schema.json" -provider registry.terraform.io/hashicorp/random \
  -name random -version "$RANDOM_VERSION" -meta "$here/meta/random.json" -out "$out/random.json.gz"
go run ./cmd/schemagen -schema "$work/schema.json" -provider registry.terraform.io/hashicorp/null \
  -name null -version "$NULL_VERSION" -out "$out/null.json.gz"
go run ./cmd/schemagen -schema "$work/schema.json" -provider registry.terraform.io/hashicorp/local \
  -name local -version "$LOCAL_VERSION" -meta "$here/meta/local.json" -out "$out/local.json.gz"
