#!/bin/bash
# Double-click this file on the Mac to pull the iPad app and open it in Xcode.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This file only works on the Mac." >&2
  exit 1
fi

osascript -e 'tell application "Xcode" to quit' >/dev/null 2>&1 || true
sleep 1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CANDIDATES=(
  "$SCRIPT_DIR"
  "$(cd "$SCRIPT_DIR/.." && pwd)"
  "$HOME/Desktop/shiftswifthr"
  "$HOME/Desktop/ShiftSwiftHR"
  "$HOME/shiftswifthr"
)

ROOT=""
for cand in "${CANDIDATES[@]}"; do
  if [[ -d "$cand/.git" && -d "$cand/mobile/ios-app/App" ]]; then
    ROOT="$cand"
    break
  fi
done

if [[ -z "$ROOT" ]]; then
  osascript -e 'display alert "ShiftSwift HR" message "Could not find the git repo. Put this file inside /Users/gskharel/Desktop/shiftswifthr and double-click it again." as critical'
  exit 1
fi

cd "$ROOT"
echo "Repo: $ROOT"

git fetch origin
# Discard local ios:sync dirt and point this folder at the iPad branch.
git checkout -f -B cursor/ios-ipad-updates-b650 origin/cursor/ios-ipad-updates-b650

cd "$ROOT/mobile"
npm install
npm run ios:sync

cd "$ROOT/mobile/ios-app/App"
pod install
open App.xcworkspace

osascript -e 'display notification "Opened App.xcworkspace. Scheme must be App, destination Gobinda’s iPAD, then Product → Clean Build Folder and Run." with title "ShiftSwift HR"'
