#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKUP="$HERE/recovery.zip"
DOMAIN=''
HTTPS=1
while (($#)); do
  case "$1" in
    --backup) BACKUP=${2:?Missing backup path}; shift 2;;
    --domain) DOMAIN=${2:?Missing domain}; shift 2;;
    --no-https) HTTPS=0; shift;;
    --help) echo 'sudo bash install.sh --domain example.com [--backup recovery.zip] [--no-https]'; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
. /etc/os-release
[[ $ID == ubuntu && ($VERSION_ID == 22.04 || $VERSION_ID == 24.04) ]] || { echo 'Ubuntu 22.04 or 24.04 required.' >&2; exit 1; }
[[ -n $DOMAIN ]] || read -r -p 'Domain pointing to this VPS (without https://): ' DOMAIN
[[ ${#DOMAIN} -le 253 && $DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo 'Invalid hostname.' >&2; exit 1; }
DOMAIN=${DOMAIN,,}
[[ -d /run/systemd/system ]] || { echo 'systemd is required.' >&2; exit 1; }
[[ -f $BACKUP ]] || { echo 'Recovery ZIP not found.' >&2; exit 1; }
BACKUP=$(readlink -f -- "$BACKUP")
for target in /opt/work-area /var/lib/work-area /etc/work-area /etc/systemd/system/work-area.service; do
  [[ ! -e $target && ! -L $target ]] || { echo "Existing installation found: $target. Nothing overwritten." >&2; exit 1; }
done
if ((HTTPS)); then
  ! command -v caddy >/dev/null || { echo 'Existing Caddy detected. Use --no-https and configure the existing proxy.' >&2; exit 1; }
  [[ ! -e /etc/caddy/Caddyfile ]] || { echo 'Existing proxy configuration detected.' >&2; exit 1; }
  if ss -ltnH '( sport = :80 or sport = :443 )' | grep -q .; then echo 'Ports 80/443 in use. Use --no-https for an existing proxy.' >&2; exit 1; fi
fi
! ss -ltnH '( sport = :3000 )' | grep -q . || { echo 'Port 3000 is already in use.' >&2; exit 1; }
case $(uname -m) in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) echo 'x64 or ARM64 required.' >&2; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl xz-utils python3 gnupg debian-keyring debian-archive-keyring apt-transport-https
STAGE=$(mktemp -d /var/tmp/work-area-install.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
python3 "$HERE/verify-extract.py" "$BACKUP" "$STAGE/restore"
cd "$STAGE"
curl --fail --silent --show-error --location --proto '=https' https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o SHASUMS256.txt
NODE_FILE=$(awk -v suffix="-linux-$ARCH.tar.xz" '$2 ~ /node-v24\./ && substr($2,length($2)-length(suffix)+1)==suffix {print $2; exit}' SHASUMS256.txt)
[[ $NODE_FILE =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || { echo 'Unable to resolve official Node 24 runtime.' >&2; exit 1; }
curl --fail --silent --show-error --location --proto '=https' "https://nodejs.org/dist/latest-v24.x/$NODE_FILE" -o "$NODE_FILE"
awk -v name="$NODE_FILE" '$2==name' SHASUMS256.txt | sha256sum --check --strict -
mkdir node
# Only official Node runtime archive, verified against its HTTPS checksum manifest.
tar -xJf "$NODE_FILE" --strip-components=1 -C node
NODE="$STAGE/node/bin/node"
"$NODE" --input-type=module - "$STAGE/restore/app/data/work-area.sqlite" <<'JS'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2],{readOnly:true});
try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity failed');if(!db.prepare("SELECT COUNT(*) n FROM users WHERE active=1 AND role='admin'").get().n)throw Error('Recovery has no active administrator');}finally{db.close();}
JS
id work-area >/dev/null 2>&1 || useradd --system --home-dir /var/lib/work-area --shell /usr/sbin/nologin work-area
install -d -m 750 -o work-area -g work-area /var/lib/work-area
mv "$STAGE/restore/app/data/work-area.sqlite" /var/lib/work-area/work-area.sqlite
chmod 600 /var/lib/work-area/work-area.sqlite
chown work-area:work-area /var/lib/work-area/work-area.sqlite
mv "$STAGE/restore/app" /opt/work-area
mv "$STAGE/node" /opt/work-area/runtime
install -d -m 700 -o work-area -g work-area /var/lib/work-area/private
ln -s /var/lib/work-area/private /opt/work-area/private
cp -- "$BACKUP" /var/lib/work-area/private/recovery-backup.zip
cp -- "$STAGE/restore/RESTORE.md" /var/lib/work-area/private/recovery-backup.zip.guide.txt
chown -R work-area:work-area /var/lib/work-area/private
chown -R root:root /opt/work-area
chmod -R u=rwX,go=rX /opt/work-area
install -d -m 750 -o root -g work-area /etc/work-area
cat > /etc/work-area/server.env <<ENV
NODE_ENV=production
APP_ORIGIN=https://$DOMAIN
HOST=127.0.0.1
PORT=3000
DB_PATH=/var/lib/work-area/work-area.sqlite
ENV
chmod 640 /etc/work-area/server.env
chown root:work-area /etc/work-area/server.env
cat > /etc/systemd/system/work-area.service <<'UNIT'
[Unit]
Description=Work Area server
After=network.target
[Service]
Type=simple
User=work-area
Group=work-area
WorkingDirectory=/opt/work-area
EnvironmentFile=/etc/work-area/server.env
ExecStart=/opt/work-area/runtime/bin/node /opt/work-area/server.mjs
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/work-area
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now work-area
READY=0
for attempt in $(seq 1 90); do
  if curl --fail --silent http://127.0.0.1:3000/api/health > "$STAGE/health.json"; then READY=1; break; fi
  sleep 1
done
((READY)) || { echo 'Backend failed. Inspect: sudo journalctl -u work-area -n 80' >&2; exit 1; }
python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["ok"]' "$STAGE/health.json"
if ((HTTPS)); then
  curl --fail --silent --show-error --location --proto '=https' https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o caddy.key
  gpg --dearmor --batch --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg caddy.key
  curl --fail --silent --show-error --location --proto '=https' https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
CADDY
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl enable caddy
  systemctl restart caddy
  echo "Backend is healthy. Caddy will issue HTTPS certificates for https://$DOMAIN once DNS and ports 80/443 reach this VPS."
else
  echo "Backend is healthy on 127.0.0.1:3000. Configure your existing HTTPS proxy for https://$DOMAIN."
fi
echo 'Restored accounts and data are retained. No new account creation needed.'
echo 'Verify sign-in, photos, quantities and pending offline queues before switching production DNS/users.'
