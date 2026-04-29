#!/bin/bash
# Export current published wiki state to a git-trackable directory.
# Run periodically (e.g. via cron) to create commit-able snapshots.
# Usage: scripts/git-export.sh [target-dir]
set -e
TARGET=${1:-./vault-export}
mkdir -p "$TARGET"
docker compose exec backend python -m app.scripts.export_to_disk "$TARGET"
cd "$TARGET" && git add -A && git commit -m "Wiki snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)" || echo "No changes."
