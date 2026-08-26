#!/bin/bash
SUITE="packages/sim/src/docbot packages/ui/src/docbotLiveText.test.ts packages/sim/src/snapshotFidelity.test.ts"
for bug in $(python packages/tools/retro/reinject.py x list | sed 's/\r$//'); do
  git checkout -q -- packages
  res=$(python packages/tools/retro/reinject.py "$bug" apply)
  if [[ "$res" != APPLIED* ]]; then echo "RESULT $bug UNPATCHABLE ($res)"; continue; fi
  out=$(npx vitest run $SUITE 2>&1 | sed 's/\[[0-9;]*m//g' | tail -30)
  if echo "$out" | grep -qE "Tests .*failed"; then
    names=$(echo "$out" | grep -oE "[a-zA-Z]+\.test\.ts" | sort -u | head -5 | tr '\n' ',')
    echo "RESULT $bug CAUGHT by:$names"
  elif echo "$out" | grep -qE "Tests +[0-9]+ passed"; then
    echo "RESULT $bug MISSED"
  else
    echo "RESULT $bug UNMEASURABLE"
  fi
done
git checkout -q -- packages
