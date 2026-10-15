#!/usr/bin/env bash
# Runs every end-to-end suite, each against a fresh local database + API. Needs no network.
#   npm run test:e2e
set -u
cd "$(dirname "$0")/.."
echo 'JOIN_CODE=testcode' > .dev.vars
status=0
for suite in keepers-e2e league-e2e lineup-e2e waivers-e2e trades-e2e extras-e2e chat-e2e logos-e2e dm-e2e nominate-e2e; do
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
