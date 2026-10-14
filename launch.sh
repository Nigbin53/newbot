#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Установи Node.js 22+ с https://nodejs.org/en/download, затем открой новый Терминал.' >&2
  exit 1
fi
exec node scripts/launch.mjs "$@"
