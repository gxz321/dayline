#!/bin/sh
set -eu
# A mounted volume hides image-layer ownership. Initialize only its root, then drop privileges.
mkdir -p /var/lib/dayline
chown node:node /var/lib/dayline
# The kernel releases this lock after a crash. Only its holder may clear the stale Node sentinel.
export DATA_DIR=/var/lib/dayline
exec su -s /bin/sh node -c 'exec flock --no-fork --nonblock /var/lib/dayline/.process.lock sh -c "rm -f /var/lib/dayline/.instance.lock; exec node /app/standalone/server.mjs"'
