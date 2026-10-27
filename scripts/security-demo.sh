#!/usr/bin/env bash
# Security beats for the demo video, against a running server. Prints HTTP statuses and error messages only.
# Usage: DEMO_PIN_FILE=../.demo-pin scripts/security-demo.sh [http://127.0.0.1:3990]
# The PIN is read from DEMO_PIN_FILE (or DEMO_PIN) and never printed.
# The lockout beat uses a TEST-NET client address (X-Forwarded-For), so the browser session stays unlocked.
set -euo pipefail
BASE="${1:-http://127.0.0.1:3990}"
PIN="${DEMO_PIN:-}"; [[ -z "$PIN" && -n "${DEMO_PIN_FILE:-}" ]] && PIN="$(tr -d '\n' < "$DEMO_PIN_FILE")"
[[ -n "$PIN" ]] || { echo "Set DEMO_PIN_FILE or DEMO_PIN" >&2; exit 2; }
ITEMS='[{"name":"Fictamol 500 mg tablets","quantity":2}]'
call() { curl -s -o /tmp/rx-sec.$$ -w '%{http_code}' -H 'Content-Type: application/json' "$@"; }
msg() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.error??j.status??"")}catch{console.log("")}' /tmp/rx-sec.$$; }
trap 'rm -f /tmp/rx-sec.$$' EXIT

echo "1) PIN lockout: 6 wrong PINs from one client"
IP="203.0.113.$((RANDOM % 250 + 1))"
for i in 1 2 3 4 5 6; do printf '   attempt %s -> %s ' "$i" "$(call -H "X-Forwarded-For: $IP" -d '{"pin":"0000"}' "$BASE/api/pharmacist/verify")"; msg; done

echo "2) Cart-hash binding: order for a cart the pharmacist did not review"
HASH="$(curl -s -H 'Content-Type: application/json' -d "{\"items\":$ITEMS}" "$BASE/api/cart" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).cartHash))')"
BODY="$(PIN="$PIN" HASH="$HASH" node -e 'console.log(JSON.stringify({items:[{name:"Fictamol 500 mg tablets",quantity:9}],pharmacistPin:process.env.PIN,cartHash:process.env.HASH}))')"
printf '   reviewed qty 2, submitted qty 9 -> %s ' "$(call -d "$BODY" "$BASE/api/paypal/create-order")"; msg

echo "3) Capture needs the server-signed approval token for this order + cart"
printf '   forged token -> %s ' "$(call -d "{\"orderID\":\"5O190127TN364715T\",\"approvalToken\":\"forged.token\",\"items\":$ITEMS}" "$BASE/api/paypal/capture-order")"; msg
echo "   (single-use: a second capture of the same order returns 409, see: npx vitest run -t 'second capture')"
