#!/usr/bin/env bash
# Runs every end-to-end suite, each against a fresh local database + API. Needs no network.
#   npm run test:e2e
set -u
cd "$(dirname "$0")/.."
# Fake Google/Apple client IDs, and provider key endpoints pointing at the local server social-e2e.mjs starts.
printf 'JOIN_CODE=testcode\nGOOGLE_CLIENT_IDS=test-google-web,test-google-ios\nAPPLE_CLIENT_IDS=test.apple.service\nGOOGLE_JWKS_URL=http://localhost:8799/google\nAPPLE_JWKS_URL=http://localhost:8799/apple\nMLB_API_BASE=http://localhost:8790\n' > .dev.vars
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
status=0
for suite in keepers-e2e league-e2e lineup-e2e waivers-e2e trades-e2e extras-e2e chat-e2e logos-e2e dm-e2e nominate-e2e draft-edit-e2e social-e2e stats-e2e; do
  rm -rf .wrangler
  npx wrangler d1 migrations apply pennant-race --local >/dev/null 2>&1
  npx wrangler dev --port 8787 >/tmp/e2e-wrangler.log 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do curl -s localhost:8787/ >/dev/null && break; sleep 1; done
  echo "=== $suite"
  out=$(node "scripts/$suite.mjs" 2>&1); rc=$?
  echo "$out" | grep -E "FAIL|PASSED|FAILED"
  [ $rc -ne 0 ] && status=1
  kill $pid 2>/dev/null; pkill -x workerd 2>/dev/null; sleep 1
done
rm -rf .wrangler .dev.vars
exit $status
