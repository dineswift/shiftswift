#!/usr/bin/env bash
# Create an upload keystore and android/key.properties for Play Store signing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
KEYSTORE_DIR="$ANDROID/keystore"
KEYSTORE="$KEYSTORE_DIR/shiftswifthr-upload.jks"
KEY_PROPS="$ANDROID/key.properties"
ALIAS="${ANDROID_KEY_ALIAS:-upload}"

if [[ -f "$KEY_PROPS" ]]; then
  echo "Already configured: $KEY_PROPS"
  exit 0
fi

mkdir -p "$KEYSTORE_DIR"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Creating upload keystore at $KEYSTORE"
  echo "You will be prompted for keystore and key passwords — store them safely (Play App Signing backup)."
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=ShiftSwift HR, OU=Mobile, O=ShiftSwift HR, L=London, C=GB"
fi

read -rsp "Keystore password: " STORE_PASS
echo ""
read -rsp "Key password (Enter for same): " KEY_PASS
echo ""
if [[ -z "$KEY_PASS" ]]; then
  KEY_PASS="$STORE_PASS"
fi

cat > "$KEY_PROPS" <<EOF
storePassword=$STORE_PASS
keyPassword=$KEY_PASS
keyAlias=$ALIAS
storeFile=keystore/shiftswifthr-upload.jks
EOF

chmod 600 "$KEY_PROPS"
echo "Wrote $KEY_PROPS"
echo "Keystore: $KEYSTORE"
echo "Add $KEYSTORE and key.properties to your secrets backup — required for all future releases."
