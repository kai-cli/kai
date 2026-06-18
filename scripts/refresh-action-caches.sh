#!/bin/bash
# Refreshes cached data for statusline action indicators.
# Run via cron every 30 minutes or manually.

STATE_DIR="$HOME/.claude/MEMORY/STATE"
GH_CACHE="$STATE_DIR/.gh-reviews-cache.json"
WIKI_CACHE="$STATE_DIR/.wiki-stale-cache.json"
WIKI_DIR="$HOME/Projects/Linksys-Wiki"

# --- GitHub PRs awaiting review ---
# Record auth status explicitly: a deauthed `gh` must surface "gh auth?" in the statusline, NOT
# silently masquerade as "no reviews" (observability-hole rule). authed=false ⇒ statusline flags it.
now_ms=$(( $(date +%s) * 1000 ))
if gh auth status >/dev/null 2>&1; then
  reviews=$(gh pr list --search "review-requested:@me" --limit 10 --json number,title,url 2>/dev/null || echo "[]")
  printf '{"updated":%d,"authed":true,"reviews":%s}\n' "$now_ms" "$reviews" > "$GH_CACHE"
else
  printf '{"updated":%d,"authed":false,"reviews":[]}\n' "$now_ms" > "$GH_CACHE"
fi

# --- Wiki page staleness (pages with Last Verified > 90 days ago) ---
# Only refresh if cache doesn't exist or is older than 24h
refresh_wiki=false
if [[ ! -f "$WIKI_CACHE" ]]; then
  refresh_wiki=true
elif (( $(( $(date +%s) - $(stat -f %m "$WIKI_CACHE") )) > 86400 )); then
  refresh_wiki=true
fi

if [[ "$refresh_wiki" == "true" && -d "$WIKI_DIR" ]]; then
  stale_count=0
  cutoff_epoch=$(( $(date +%s) - 7776000 ))

  while IFS= read -r file; do
    # Look for a date within 3 lines after "## Last Verified"
    date_str=$(sed -n '/^## Last Verified/,/^#/{/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/p;}' "$file" | head -1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
    [[ -z "$date_str" ]] && continue
    file_epoch=$(date -j -f "%Y-%m-%d" "$date_str" +%s 2>/dev/null || true)
    [[ -z "$file_epoch" ]] && continue
    if (( file_epoch < cutoff_epoch )); then
      ((stale_count++))
    fi
  done < <(find "$WIKI_DIR" -name "*.md" -not -path "*/\.*")

  printf '{"updated":%d,"staleCount":%d}\n' "$now_ms" "$stale_count" > "$WIKI_CACHE"
fi
