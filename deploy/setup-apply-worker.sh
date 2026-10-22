#!/usr/bin/env bash
# One-command setup of Orbit's hosted apply worker on a fresh Ubuntu server (22.04 or 24.04, x86 or ARM, e.g. an
# Oracle Cloud Always Free instance). Run it on the server as a user with sudo:
#
#   curl -fsSL https://raw.githubusercontent.com/Iamishfaq07/ishai/main/deploy/setup-apply-worker.sh -o setup.sh
#   bash setup.sh
#
# What it does: installs Docker and git, clones (or updates) the repository into ~/ishai, keeps the worker's
# settings in ~/ishai/deploy/apply-worker.env (readable by you only), then builds and starts the worker with
# deploy/hosted-apply.compose.yaml. Running it again updates the code and restarts the worker with the same
# settings. Commands afterwards: `bash setup.sh status`, `bash setup.sh logs`, `bash setup.sh stop`.
#
# The secret it creates goes in two places only: this server's env file and the API's ORBIT_APPLY_WORKER_SECRET
# (Railway → the API service → Variables). Never paste it into a chat, an issue or the code.
set -euo pipefail

REPO_URL="${ORBIT_REPO_URL:-https://github.com/Iamishfaq07/ishai.git}"
DIR="${ORBIT_DIR:-$HOME/ishai}"
ENV_FILE="$DIR/deploy/apply-worker.env"
COMPOSE=(sudo docker compose --env-file "$ENV_FILE" -f "$DIR/deploy/hosted-apply.compose.yaml")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

case "${1:-setup}" in
  status)
    "${COMPOSE[@]}" ps
    exit 0
    ;;
  logs)
    "${COMPOSE[@]}" logs --tail 100 -f
    exit 0
    ;;
  stop)
    "${COMPOSE[@]}" down
    exit 0
    ;;
  setup) ;;
  *)
    echo "Usage: bash setup.sh [setup|status|logs|stop]" >&2
    exit 2
    ;;
esac

say "1/5 Installing Docker and git (skipped if already there)"
if ! command -v docker >/dev/null 2>&1 || ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl git
  sudo apt-get install -y docker.io docker-compose-v2 || sudo apt-get install -y docker.io docker-compose-plugin
fi
command -v git >/dev/null 2>&1 || sudo apt-get install -y git
sudo systemctl enable --now docker

say "2/5 Getting the code into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin main
  git -C "$DIR" checkout --quiet main
  git -C "$DIR" reset --quiet --hard origin/main
else
  git clone --quiet --depth 1 "$REPO_URL" "$DIR"
fi

say "3/5 Worker settings ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  read -r -p "Orbit API address [https://api.orbitanswer.com]: " api
  api="${api:-https://api.orbitanswer.com}"
  case "$api" in https://*) ;; *) echo "The API address must start with https://" >&2; exit 1 ;; esac
  read -r -s -p "Worker secret (press Enter to create a new one): " secret
  echo
  created=0
  if [ -z "$secret" ]; then
    secret="$(openssl rand -hex 32)"
    created=1
  fi
  if [ "${#secret}" -lt 32 ]; then echo "The secret must be at least 32 characters." >&2; exit 1; fi
  umask 077
  cat >"$ENV_FILE" <<EOF
ORBIT_API_URL=${api%/}
ORBIT_APPLY_WORKER_SECRET=$secret
ORBIT_APPLY_SECCOMP_PROFILE=$DIR/apps/apply-worker/seccomp_profile.json
EOF
  if [ "$created" = 1 ]; then
    say "New worker secret (shown once; it's also saved in $ENV_FILE):"
    echo "$secret"
    echo "Copy it into Railway → your API service → Variables as ORBIT_APPLY_WORKER_SECRET, and set"
    echo "ORBIT_HOSTED_APPLY=true there too, then redeploy the API. Don't paste it anywhere else."
  fi
else
  echo "Keeping the existing settings. To change them, edit $ENV_FILE and run this again."
  # The repository may have moved: keep the seccomp path pointing at this checkout.
  sed -i "s#^ORBIT_APPLY_SECCOMP_PROFILE=.*#ORBIT_APPLY_SECCOMP_PROFILE=$DIR/apps/apply-worker/seccomp_profile.json#" "$ENV_FILE"
fi

say "4/5 Building and starting the worker (the first build takes 5-15 minutes)"
"${COMPOSE[@]}" up -d --build

say "5/5 Checking it started"
sleep 15
"${COMPOSE[@]}" ps
if "${COMPOSE[@]}" ps --status running --quiet | grep -q .; then
  echo
  echo "The worker is running. It restarts by itself after a reboot."
  echo "In Orbit, Auto Apply's setup shows the worker as online within about 90 seconds of the API being"
  echo "redeployed with ORBIT_HOSTED_APPLY=true and the same secret."
  echo "Logs: bash $0 logs    Status: bash $0 status    Stop: bash $0 stop"
else
  echo
  echo "The worker isn't running. Recent logs:" >&2
  "${COMPOSE[@]}" logs --tail 50 >&2
  exit 1
fi
