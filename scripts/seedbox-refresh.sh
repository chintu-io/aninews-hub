#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${ANINEWS_REPO_DIR:-$HOME/aninews-hub}"
BRANCH="${ANINEWS_BRANCH:-main}"
LOCK_DIR="${ANINEWS_LOCK_DIR:-$HOME/.cache/aninews-hub-refresh.lock}"
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

mkdir -p "$(dirname "$LOCK_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$LOG_PREFIX refresh already running; exiting"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

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
git push origin "$BRANCH"

echo "$LOG_PREFIX $(date -Is) refresh pushed successfully"
