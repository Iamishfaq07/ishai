#!/bin/sh
# Re-records every fixture the films replay, from a fresh local stack (C:\Users\Ishfaq\tools\orbit-drive\video\stack.sh:
# API 8034 through tools/demo_api.py, web 5197, mock providers, a new temp SQLite database).
#   sh marketing/video/tools/record-all.sh            (from the repo root; the stack must be running)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
DB="sqlite+aiosqlite:///C:/Users/Ishfaq/AppData/Local/Temp/orbit-video/stack/db.sqlite"
DRIVE=/c/Users/Ishfaq/tools/orbit-drive/video
cd "$REPO/apps/api"
ORBIT_DATABASE_URL="$DB" uv run python ../../marketing/screens/seed.py --api http://localhost:8034 --web http://localhost:5197 all
ORBIT_DATABASE_URL="$DB" uv run python ../../marketing/video/tools/seed_video.py all
sh "$DRIVE/restart-api.sh"   # the job feed reads its posts at startup
cd "$REPO/marketing/video"
node tools/record-fixtures.mjs
# Each flow changes what it touches, so each starts from its own seed step.
for f in resume linkedin offer dayloop live jobs; do
  case $f in
    resume) (cd "$REPO/apps/api" && ORBIT_DATABASE_URL="$DB" uv run python ../../marketing/video/tools/seed_video.py draft) ;;
    linkedin) (cd "$REPO/apps/api" && ORBIT_DATABASE_URL="$DB" uv run python ../../marketing/video/tools/seed_video.py linkedin) ;;
    offer) (cd "$REPO/apps/api" && ORBIT_DATABASE_URL="$DB" uv run python ../../marketing/video/tools/seed_video.py offer) ;;
  esac
  node tools/record-flows.mjs $f
done
# The ids the films open (the seed state itself is gitignored).
node -e "const s=require('../screens/.seed-state.json'), l=require('./fixtures/flows/live.json'); require('fs').writeFileSync('fixtures/ids.json', JSON.stringify({resume:s.resume_id, draft:s.draft_resume_id, document:s.document_id, mockReview:s.mock_session_id, interviewReview:s.interview_session_id, offer:s.offer_id, tracker:s.tracker, liveInterview:l.__sessions.interview, liveMock:l.__sessions.mock}, null, 1))"
