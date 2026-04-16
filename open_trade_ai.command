#!/bin/bash
# TRADE AI — Open All Pages in Browser
# Double-click pentru a deschide toate paginile TRADE AI în Chrome

BASE_URL="https://trade-ai-3rzn6ry36q-ew.a.run.app"

echo "╔══════════════════════════════════════════╗"
echo "║  TRADE AI — Opening Live Pages           ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "→ URL: $BASE_URL"
echo ""

# Deschide toate paginile cheie în Chrome cu taburi separate
open -a "Google Chrome" \
  "$BASE_URL/arena" \
  "$BASE_URL/cockpit" \
  "$BASE_URL/dashboard" \
  "$BASE_URL/crypto-radar" \
  "$BASE_URL/polymarket"

echo "✅ Deschis în Chrome:"
echo "   /arena"
echo "   /cockpit"
echo "   /dashboard"
echo "   /crypto-radar"
echo "   /polymarket"
echo ""
echo "── Quick Status Check ──────────────────────"
curl -o /dev/null -s -w "arena:        %{http_code}\n" "$BASE_URL/arena"
curl -o /dev/null -s -w "cockpit:      %{http_code}\n" "$BASE_URL/cockpit"
curl -o /dev/null -s -w "dashboard:    %{http_code}\n" "$BASE_URL/dashboard"
curl -o /dev/null -s -w "crypto-radar: %{http_code}\n" "$BASE_URL/crypto-radar"
curl -o /dev/null -s -w "polymarket:   %{http_code}\n" "$BASE_URL/polymarket"
echo ""
echo "✅ Done"
