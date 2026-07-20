#!/usr/bin/env bash
# Set the project-board Status for one or more story issues.
# Usage: scripts/board-status.sh <Todo|In Progress|Done> <issue#> [issue# ...]
set -euo pipefail

OWNER="sh4rkfx"
PROJECT_NUM=2
FIELD_ID="PVTSSF_lAHOAI2Bxs4Bd56EzhYX__Q"
case "$1" in
  Todo) OPT="f75ad846" ;;
  "In Progress") OPT="47fc9ee4" ;;
  Done) OPT="98236657" ;;
  *) echo "unknown status: $1" >&2; exit 1 ;;
esac
shift

PROJECT_ID=$(gh project view "$PROJECT_NUM" --owner "$OWNER" --format json -q .id)
ITEMS=$(gh project item-list "$PROJECT_NUM" --owner "$OWNER" --format json --limit 100)

for n in "$@"; do
  ITEM_ID=$(echo "$ITEMS" | node -e "
    const d=JSON.parse(require('fs').readFileSync(0));
    const it=d.items.find(i=>i.content && i.content.number===parseInt(process.argv[1]));
    if(it) console.log(it.id);" "$n")
  if [ -z "$ITEM_ID" ]; then echo "issue #$n not on board" >&2; continue; fi
  gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
    --field-id "$FIELD_ID" --single-select-option-id "$OPT" >/dev/null
  echo "#$n -> $1"
done
