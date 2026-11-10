#!/usr/bin/env bash
# Build the test deployment in deploy/: web app + API function (prebundled with esbuild).
set -euo pipefail
cd "$(dirname "$0")/.."
(cd apps/app && EXPO_PUBLIC_API_URL="" npx expo export --platform web --output-dir ../../deploy/dist-web)
printf '/*  /index.html  200\n' > deploy/dist-web/_redirects
node_modules/.bin/esbuild deploy/api-entry.mts --bundle --platform=node --format=esm --target=node20 \
  --outfile=deploy/netlify/functions/api.mjs --log-level=warning \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
echo "deploy/ ready"
