#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
EVALPILOT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd -P)"
CLI="${EVALPILOT_ROOT}/dist/src/cli/index.js"

if [[ ! -f "${CLI}" ]]; then
  echo "EvalPilot CLI 尚未构建。请先在 ${EVALPILOT_ROOT} 运行 npm install 和 npm run build。" >&2
  exit 1
fi

cd "${EVALPILOT_ROOT}"
exec node "${CLI}" "$@"
