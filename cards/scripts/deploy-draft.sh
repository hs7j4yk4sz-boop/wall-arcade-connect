#!/bin/bash
# A Netlify draft of the card service with the hub on it, for review: no --prod, no rare-profile, the site's published deploy
# does not move. Blobs are shared by every deploy of a site, so the draft holds only netlify/draft-functions (read-only: a
# store that writes nothing), no scheduled function, and its _redirects let it read production's public files, nothing else.
#   cards/scripts/deploy-draft.sh [alias]     → https://<alias>--wall-arcade-cards.netlify.app
set -euo pipefail
ALIAS="${1:-finale}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="https://$ALIAS--wall-arcade-cards.netlify.app"
LIVE="https://wall-arcade-cards.netlify.app"
OUT="$ROOT/dist/draft"
cd "$ROOT"
npm run build:hub -- --output dist/hub-preview.zip --force --preview "$SITE"
rm -rf "$OUT" && mkdir -p "$OUT"
unzip -q dist/hub-preview.zip -d "$OUT"
cat > "$OUT/_redirects" <<REDIRECTS
/games.json        $LIVE/games.json        200
/games/*           $LIVE/games/:splat      200
/people/all.json   $LIVE/people/all.json   200
/people/sprites/*  $LIVE/people/sprites/:splat 200
/api/*             /404.html               403
REDIRECTS
cd "$ROOT/cards"
npx -y netlify-cli@27.9.0 deploy --no-build --dir "$OUT" --functions netlify/draft-functions --alias "$ALIAS"
echo "$SITE"
