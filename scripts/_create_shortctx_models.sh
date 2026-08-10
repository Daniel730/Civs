#!/usr/bin/env bash
# Create short-context Ollama aliases for Minecraft QA on RTX 3060 12GB.
# Does NOT require sudo. Global OLLAMA_CONTEXT_LENGTH=65536 still needs sudo fix.
set -euo pipefail
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

create_one() {
  local name="$1" from="$2" ctx="$3"
  cat >"$TMP/Modelfile" <<EOF
FROM $from
PARAMETER num_ctx $ctx
PARAMETER num_predict 512
PARAMETER temperature 0.2
EOF
  echo "Creating $name from $from (num_ctx=$ctx)"
  ollama create "$name" -f "$TMP/Modelfile"
}

create_one "hermes-fast-mc" "hermes-fast" 8192
create_one "hermes-agent-mc" "hermes-agent" 8192
create_one "hermes-coder-mc" "hermes-coder" 8192

echo "=== tags (mc) ==="
curl -sS http://127.0.0.1:11434/api/tags | python3 -c 'import sys,json; print([m["name"] for m in json.load(sys.stdin).get("models",[]) if "-mc" in m["name"]])'
