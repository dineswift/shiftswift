#!/usr/bin/env bash
# Create an upload keystore and android/key.properties for Play Store signing.
#
# Interactive (default):
#   npm run playstore:signing
#
# Non-interactive:
#   export ANDROID_KEYSTORE_PASSWORD=...
#   export ANDROID_KEY_PASSWORD=...          # optional, defaults to keystore password
#   export ANDROID_KEY_ALIAS=upload         # optional
#   bash scripts/setup-android-signing.sh --non-interactive
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
KEYSTORE_DIR="$ANDROID/keystore"
KEYSTORE="$KEYSTORE_DIR/shiftswifthr-upload.jks"
KEY_PROPS="$ANDROID/key.properties"
ALIAS="${ANDROID_KEY_ALIAS:-upload}"
NON_INTERACTIVE=0

for arg in "$@"; do
  if [[ "$arg" == "--non-interactive" ]]; then
    NON_INTERACTIVE=1
  fi
done

if [[ -f "$KEY_PROPS" ]]; then
  echo "Already configured: $KEY_PROPS"
  exit 0
fi

mkdir -p "$KEYSTORE_DIR"

if [[ ! -f "$KEYSTORE" ]]; then
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    if [[ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]]; then
      echo "Set ANDROID_KEYSTORE_PASSWORD for non-interactive keystore creation."
      exit 1
    fi
    KEY_PASS="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
    echo "Creating upload keystore at $KEYSTORE (non-interactive)"
    keytool -genkeypair -v \
      -keystore "$KEYSTORE" \
      -alias "$ALIAS" \
      -keyalg RSA \
      -keysize 2048 \
      -validity 10000 \
      -storepass "$ANDROID_KEYSTORE_PASSWORD" \
      -keypass "$KEY_PASS" \
      -dname "CN=ShiftSwift HR, OU=Mobile, O=ShiftSwift HR, L=London, C=GB"
    STORE_PASS="$ANDROID_KEYSTORE_PASSWORD"
  else
    echo "Creating upload keystore at $KEYSTORE"
    echo "You will be prompted for keystore and key passwords — store them safely (Play App Signing backup)."
    keytool -genkeypair -v \
      -keystore "$KEYSTORE" \
      -alias "$ALIAS" \
      -keyalg RSA \
      -keysize 2048 \
      -validity 10000 \
      -dname "CN=ShiftSwift HR, OU=Mobile, O=ShiftSwift HR, L=London, C=GB"
    read -rsp "Keystore password: " STORE_PASS
    echo ""
    read -rsp "Key password (Enter for same): " KEY_PASS
    echo ""
    if [[ -z "$KEY_PASS" ]]; then
      KEY_PASS="$STORE_PASS"
    fi
  fi
else
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    STORE_PASS="${ANDROID_KEYSTORE_PASSWORD:?Set ANDROID_KEYSTORE_PASSWORD}"
    KEY_PASS="${ANDROID_KEY_PASSWORD:-$STORE_PASS}"
  else
    read -rsp "Existing keystore password: " STORE_PASS
    echo ""
    read -rsp "Key password (Enter for same): " KEY_PASS
    echo ""
    if [[ -z "$KEY_PASS" ]]; then
      KEY_PASS="$STORE_PASS"
    fi
  fi
fi

cat > "$KEY_PROPS" <<EOF
storePassword=$STORE_PASS
keyPassword=$KEY_PASS
keyAlias=$ALIAS
storeFile=../keystore/shiftswifthr-upload.jks
EOF

chmod 600 "$KEY_PROPS"
echo "Wrote $KEY_PROPS"
echo "Keystore: $KEYSTORE"
echo "Back up $KEYSTORE and key.properties — required for all future Play releases."
