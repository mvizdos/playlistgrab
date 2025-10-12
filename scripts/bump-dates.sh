#!/usr/bin/env bash
set -euo pipefail

# Simple helper to update "Last updated: ..." lines in policy HTML files.
# Usage:
#   ./scripts/bump-dates.sh            # uses today's date (e.g. "October 12, 2025")
#   ./scripts/bump-dates.sh "2025-10-12"  # use an ISO date (YYYY-MM-DD)
#   ./scripts/bump-dates.sh "January 1, 2026" # use a custom formatted date

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FILES=("tos.html" "privacy.html")

format_from_iso() {
  iso="$1"
  # Try BSD date (macOS) first, then GNU date as fallback
  if date -j -f "%Y-%m-%d" "$iso" "+%B %e, %Y" >/dev/null 2>&1; then
    date -j -f "%Y-%m-%d" "$iso" "+%B %e, %Y"
  else
    date -d "$iso" "+%B %e, %Y"
  fi
}

if [ "$#" -ge 1 ]; then
  ARG="$1"
  if [[ "$ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    FORMATTED=$(format_from_iso "$ARG")
  else
    FORMATTED="$ARG"
  fi
else
  FORMATTED=$(date "+%B %e, %Y")
fi

# Normalize spaces (e.g. replace double-space day formatting)
FORMATTED=$(echo "$FORMATTED" | awk '{$1=$1;print}')

echo "Bumping 'Last updated' to: $FORMATTED"

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    # Use perl for portable in-place editing across platforms
    perl -i -pe "s/(Last updated: ).*/\$1$FORMATTED/" "$f"
    echo "Updated: $f"
  else
    echo "Skipping (not found): $f"
  fi
done

echo "Done. Review changes with: git diff"
