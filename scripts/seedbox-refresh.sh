#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${ANINEWS_REPO_DIR:-$HOME/aninews-hub}"
BRANCH="${ANINEWS_BRANCH:-main}"
LOCK_DIR="${ANINEWS_LOCK_DIR:-$HOME/.cache/aninews-hub-refresh.lock}"
# Use an advisory file lock so abrupt termination cannot leave a stale
# directory lock blocking every subsequent scheduled refresh.
LOCK_FILE="${ANINEWS_LOCK_FILE:-${LOCK_DIR}.flock}"
LOG_PREFIX="[AniNews Hub]"

# Cron does not load the interactive shell, so make common Node locations available.
for node_bin in "$HOME/.nvm/versions/node/"*/bin "$HOME/.local/bin" "/usr/local/bin" "/usr/bin"; do
  if [ -x "$node_bin/node" ]; then
    export PATH="$node_bin:$PATH"
    break
  fi
done

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "$LOG_PREFIX node was not found" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "$LOG_PREFIX git was not found" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")"

if ! command -v flock >/dev/null 2>&1; then
  echo "$LOG_PREFIX flock was not found; cannot safely lock refresh" >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$LOG_PREFIX refresh already running; exiting"
  exit 0
fi

cd "$REPO_DIR"

echo "$LOG_PREFIX $(date -Is) starting refresh"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ ! -d node_modules ]; then
  npm ci --omit=dev
fi

npm run fetch
node scripts/sankaku-fix.mjs
npm run generate:rss

git add site/data/articles.json site/debug/sankaku.json site/rss

if git diff --cached --quiet; then
  echo "$LOG_PREFIX no feed changes; nothing to push"
  exit 0
fi

git commit -m "Refresh news feeds"

if ! git push origin "$BRANCH"; then
  # A code or data commit may have reached the remote after our initial
  # fetch. Rebase our generated-data commit instead of force-pushing or
  # discarding remote commits. If generated files conflict, abort safely;
  # the next scheduled run will fetch the remote and regenerate the data.
  echo "$LOG_PREFIX push rejected; fetching remote changes and retrying safely" >&2
  git fetch origin "$BRANCH"

  if git rebase "origin/$BRANCH"; then
    if ! git push origin "$BRANCH"; then
      echo "$LOG_PREFIX retry push failed; remote was not overwritten" >&2
      exit 1
    fi
  else
    git rebase --abort || true
    echo "$LOG_PREFIX rebase conflict; refresh was not pushed and remote was left untouched" >&2
    exit 1
  fi
fi

echo "$LOG_PREFIX $(date -Is) refresh pushed successfully"
