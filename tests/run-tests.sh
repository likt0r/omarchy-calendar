#!/usr/bin/env bash
# Runs every test in the repo. No arguments, no options.
set -uo pipefail

cd "$(dirname "$0")/.."
status=0

run() {
  local label="$1"; shift
  printf '%-24s' "$label"
  if out=$("$@" 2>&1); then
    echo "$out" | tail -1
  else
    echo "FAILED"
    echo "$out" | sed 's/^/    /'
    status=1
  fi
}

# -B: no __pycache__ next to the exporter.
run "exporter (python)" python3 -B tests/exporter-test.py
run "json contract" python3 -B tests/contract-test.py

if command -v node >/dev/null 2>&1; then
  run "Events.js (node)" node tests/events-test.js
else
  printf '%-24sSKIPPED (node not installed)\n' "Events.js (node)"
fi

printf '%-24s' "manifest.json"
if python3 -c 'import json,sys; d=json.load(open("manifest.json"));
missing=[k for k in ("schemaVersion","id","name","version","author","license",
                     "description","kinds","entryPoints") if k not in d];
sys.exit("missing keys: %s" % missing if missing else 0)' 2>&1; then
  echo "ok    valid json, required keys present"
else
  echo "FAILED"; status=1
fi

# Only where a Qt toolchain is around; the import warnings for qs.Commons /
# qs.Ui are expected, so this looks for parse errors alone.
QMLLINT=$(command -v qmllint || echo /usr/lib/qt6/bin/qmllint)
printf '%-24s' "qml syntax"
if [[ -x "$QMLLINT" ]]; then
  if "$QMLLINT" --compiler disable Panel.qml BarWidget.qml 2>&1 \
      | grep -qiE 'syntax|unexpected token|expected token'; then
    echo "FAILED"
    "$QMLLINT" --compiler disable Panel.qml BarWidget.qml 2>&1 \
      | grep -iE 'syntax|unexpected token|expected token' | sed 's/^/    /'
    status=1
  else
    echo "ok    no parse errors"
  fi
else
  echo "SKIPPED (qmllint not installed)"
fi

exit $status
