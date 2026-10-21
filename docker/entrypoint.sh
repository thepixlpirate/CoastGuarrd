#!/bin/sh
set -e

# Run as the user/group given by PUID/PGID (Unraid default: 99/100 = nobody/users)
# so files created in your media folders have the right owner.
PUID="${PUID:-99}"
PGID="${PGID:-100}"
umask "${UMASK:-002}"

mkdir -p "${CG_DATA_DIR:-/config}"

if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" "${CG_DATA_DIR:-/config}" 2>/dev/null || true
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi

exec "$@"
