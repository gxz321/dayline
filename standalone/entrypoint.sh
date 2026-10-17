#!/bin/sh
set -eu
# A mounted volume hides image-layer ownership. Initialize only its root, then drop privileges.
mkdir -p /var/lib/dayline
chown node:node /var/lib/dayline
exec su -s /bin/sh node -c 'exec node /app/standalone/server.mjs'
