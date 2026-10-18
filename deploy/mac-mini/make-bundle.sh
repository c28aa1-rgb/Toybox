#!/bin/bash
# Run on the dev Mac from the repo root:  bash deploy/mac-mini/make-bundle.sh
# Produces deploy-bundle/toybox-server/ (+ .zip): only what the server needs, no art, client or node_modules.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=deploy-bundle/toybox-server
rm -rf deploy-bundle
mkdir -p "$OUT/client" "$OUT/deploy"
cp package.json package-lock.json tsconfig.base.json "$OUT/"
cp client/package.json "$OUT/client/"   # npm workspaces need every listed workspace present
rsync -a --exclude node_modules --exclude dist shared server "$OUT/"
rsync -a deploy/mac-mini "$OUT/deploy/"
(cd deploy-bundle && zip -qr toybox-server.zip toybox-server)
du -sh deploy-bundle/toybox-server deploy-bundle/toybox-server.zip
