# TRADE AI — Smoke Test Suite

**Purpose:** Validate critical endpoints are responding correctly post-deployment

## Critical Endpoints

### 1. Health Check
```bash
curl -s https://trade-ai-657910853930.europe-west1.run.app/api/v2/health | jq '.overall_status'
# Expected: "HEALTHY" or "DEGRADED" (not CRITICAL)
```

### 2. Polymarket Status
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/v2/polymarket?action=status" | jq '.divisions'
# Expected: 16 (number of divisions)
```

### 3. Polymarket Scan
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/v2/polymarket?action=scan&division=CRYPTO" | jq '.scan.division'
# Expected: "CRYPTO"
```

### 4. Polymarket Markets
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/v2/polymarket?action=markets&division=TRENDING" | jq '.markets | length'
# Expected: > 0 (at least some markets)
```

### 5. Polymarket Wallet
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/v2/polymarket?action=wallet" | jq '.wallet.totalBalance'
# Expected: 16000 (16 divisions × $1000)
```

### 6. Polymarket Gladiators
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/v2/polymarket?action=gladiators" | jq '.gladiators | length'
# Expected: 16 (one per division)
```

### 7. Auth Status
```bash
curl -s "https://trade-ai-657910853930.europe-west1.run.app/api/auth" | jq '.authenticated'
# Expected: false (not logged in)
```

### 8. Main Page Load
```bash
curl -s -I "https://trade-ai-657910853930.europe-west1.run.app/" | grep "HTTP"
# Expected: HTTP/2 200 (page loads)
```

## Test Script

```bash
#!/bin/bash
BASE_URL="https://trade-ai-657910853930.europe-west1.run.app"
PASSED=0
FAILED=0

test_endpoint() {
  local name=$1
  local url=$2
  local expect=$3
  
  echo -n "Testing $name... "
  result=$(curl -s "$url" | jq -r "$expect" 2>/dev/null)
  
  if [ -z "$result" ] || [ "$result" = "null" ]; then
    echo "❌ FAILED (expected: $expect, got: $result)"
    FAILED=$((FAILED+1))
  else
    echo "✅ PASSED ($result)"
    PASSED=$((PASSED+1))
  fi
}

test_endpoint "Health" "$BASE_URL/api/v2/health" ".overall_status"
test_endpoint "Polymarket Status" "$BASE_URL/api/v2/polymarket?action=status" ".divisions"
test_endpoint "Polymarket Scan" "$BASE_URL/api/v2/polymarket?action=scan&division=CRYPTO" ".scan.division"
test_endpoint "Polymarket Markets" "$BASE_URL/api/v2/polymarket?action=markets&division=TRENDING" ".markets | length"
test_endpoint "Polymarket Wallet" "$BASE_URL/api/v2/polymarket?action=wallet" ".wallet.totalBalance"
test_endpoint "Polymarket Gladiators" "$BASE_URL/api/v2/polymarket?action=gladiators" ".gladiators | length"

echo ""
echo "Results: $PASSED passed, $FAILED failed"
exit $FAILED
```

## Run After Deploy

```bash
bash SMOKE_TESTS.md
```

If any fail, check `/api/v2/health` for more details.
