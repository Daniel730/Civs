#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-http://127.0.0.1:41493}"

echo "=== slots before ==="
curl -sS -m 5 "$BASE/slots" | python3 -c 'import sys,json; d=json.load(sys.stdin); s=d[0]; nt=(s.get("next_token") or [{}])[0]; print("processing", s.get("is_processing"), "decoded", nt.get("n_decoded"), "remain", nt.get("n_remain"), "n_predict", (s.get("params") or {}).get("n_predict"))'

for action in cancel release stop; do
  url="$BASE/slots/0?action=$action"
  echo "POST $url"
  curl -sS -m 5 -X POST "$url" -H 'Content-Type: application/json' -d '{}' || true
  echo
done

echo "POST $BASE/abort"
curl -sS -m 5 -X POST "$BASE/abort" || true
echo

sleep 1
echo "=== slots after ==="
curl -sS -m 5 "$BASE/slots" | python3 -c 'import sys,json; d=json.load(sys.stdin); s=d[0]; nt=(s.get("next_token") or [{}])[0]; print("processing", s.get("is_processing"), "decoded", nt.get("n_decoded"), "remain", nt.get("n_remain"))'
