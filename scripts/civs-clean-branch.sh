#!/usr/bin/env bash
# civs-clean-branch.sh — create a Civs-only branch (no AI World) for safe push.
# NON-DESTRUCTIVE: your working tree is untouched; this only makes a new branch where the
# AI World paths are untracked via `git rm --cached`. Never force-push the source branch.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC_BRANCH="$(git branch --show-current)"
CLEAN_BRANCH="civs-clean"

# Paths that are AI World, not Civs plugin.
AIWORLD_PATHS=(
  "integration-tests/runner"
  "lib/ai-world"
  "lib/survival"
  "reports/aiworld-experiences"
  "reports/aiworld-finetune"
  "scripts/aiworld-finetune.py"
  "docs/AIWORLD-COORD.md"
  "docs/AIWORLD_AUDIT.md"
  "docs/AIWORLD_LEARNING.md"
  "docs/AIWORLD_NEURAL.md"
)

echo "Creating branch '$CLEAN_BRANCH' from '$SRC_BRANCH' (working tree untouched)..."
git checkout -b "$CLEAN_BRANCH"

# Untrack AI World files but keep them on disk.
to_rm=()
while IFS= read -r f; do [ -n "$f" ] && to_rm+=("$f"); done < <(git ls-files "${AIWORLD_PATHS[@]}")
if [ "${#to_rm[@]}" -gt 0 ]; then
  git rm --cached -q -- "${to_rm[@]}"
fi

# Persist the exclusion so future commits on this branch stay Civs-only.
printf '%s\n' "${AIWORLD_PATHS[@]}" >> .gitignore.aiworld-excluded

git commit -q -m "chore: civs-clean branch — untrack AI World paths for safe Civs push" || \
  echo "(nothing to commit — already clean)"
echo "Done. Push with: git push <civs-remote> $CLEAN_BRANCH"
echo "Return to dev branch with: git checkout $SRC_BRANCH"
