#!/bin/bash
# TRADE AI — Smoke Tests
BASE="https://trade-ai-657910853930.europe-west1.run.app"
PASS=0; FAIL=0

check() {
  local name=$1 url=$2 expected=$3
  local code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [[ "$code" == "$expected" ]]; then
    echo "✅ $name ($code)"
    ((PASS++))
  else
    echo "❌ $name — got $code, expected $expected"
    ((FAIL++))
  fi
}

echo "=== TRADE AI SMOKE TESTS ==="
check "Health v2"           "$BASE/api/v2/health"                            "200"
check "Polymarket status"   "$BASE/api/v2/polymarket?action=status"          "200"
check "Polymarket wallet"   "$BASE/api/v2/polymarket?action=wallet"          "200"
check "Polymarket markets"  "$BASE/api/v2/polymarket?action=markets&division=CRYPTO" "200"
check "Auth check"          "$BASE/api/auth"                                 "200"
check "Dashboard"           "$BASE/api/dashboard"                            "200"
check "DeepSeek status"     "$BASE/api/v2/deepseek-status"                   "200"
check "Main page"           "$BASE/"                                         "200"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && echo "🟢 ALL GOOD" || echo "🔴 FIX NEEDED"
