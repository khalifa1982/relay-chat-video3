#!/usr/bin/env bash
#
# publish-release.sh — Publish a new RELAY APK so installed apps auto-update.
#
# Usage:
#   scripts/publish-release.sh <path-to-app.apk> [versionName]
#
# Examples:
#   scripts/publish-release.sh ~/Downloads/relay-mobile-v1_0_7.apk 1.0.7
#   scripts/publish-release.sh ./relay.apk            # auto-detect version from filename
#
# What it does:
#   1. Detects the version name (from the 2nd arg or the APK filename).
#   2. Computes buildNumber from the version (1.0.7 -> 7) or auto-increments.
#   3. Writes version.json pointing at the public release host.
#   4. Creates a GitHub Release on the PUBLIC repo with relay-mobile.apk + version.json.
#
# Installed apps poll every 10 minutes (and on launch/resume); within minutes
# they detect the new release, download it with a progress bar, and prompt
# install + restart. End users do nothing manual.

set -euo pipefail

REPO="khalifa1982/relay-app-releases"
APK_PATH="${1:-}"
VERSION_NAME="${2:-}"

if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "ERROR: pass the path to the built APK. e.g. scripts/publish-release.sh ./relay-mobile-v1_0_7.apk 1.0.7" >&2
  exit 1
fi

# Derive version name if not provided: look for d.d.d in the filename.
if [[ -z "$VERSION_NAME" ]]; then
  base="$(basename "$APK_PATH")"
  VERSION_NAME="$(echo "$base" | grep -oE '[0-9]+[._][0-9]+[._][0-9]+' | head -1 | tr '_' '.')"
fi
if [[ -z "$VERSION_NAME" ]]; then
  echo "ERROR: could not detect version name; pass it as the 2nd argument (e.g. 1.0.7)." >&2
  exit 1
fi

# buildNumber = last segment of the version (1.0.7 -> 7). Override with BUILD_NUMBER env.
BUILD_NUMBER="${BUILD_NUMBER:-$(echo "$VERSION_NAME" | awk -F. '{print $NF + 0}')}"
TAG="v${VERSION_NAME}"
TMP="$(mktemp -d)"
cp "$APK_PATH" "$TMP/relay-mobile.apk"

# Integrity: compute the APK's SHA-256 and embed it in the manifest. Installed
# apps recompute this over the downloaded file and refuse to install on a
# mismatch (audit follow-up). Prefer sha256sum, fall back to shasum / openssl.
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$TMP/relay-mobile.apk" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$TMP/relay-mobile.apk" | awk '{print $1}')"
else
  SHA256="$(openssl dgst -sha256 "$TMP/relay-mobile.apk" | awk '{print $NF}')"
fi
if [[ -z "$SHA256" ]]; then
  echo "ERROR: could not compute the APK SHA-256." >&2
  exit 1
fi
echo "APK SHA-256: ${SHA256}"

cat > "$TMP/version.json" <<JSON
{
  "buildNumber": ${BUILD_NUMBER},
  "versionName": "${VERSION_NAME}",
  "apkUrl": "https://github.com/${REPO}/releases/latest/download/relay-mobile.apk",
  "sha256": "${SHA256}",
  "mandatory": false,
  "notes": "RELAY ${VERSION_NAME}"
}
JSON

echo "Publishing ${TAG} (build ${BUILD_NUMBER}) to ${REPO} ..."
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  # Replace assets on an existing tag.
  gh release upload "$TAG" "$TMP/relay-mobile.apk" "$TMP/version.json" -R "$REPO" --clobber
else
  gh release create "$TAG" "$TMP/relay-mobile.apk" "$TMP/version.json" \
    -R "$REPO" --title "RELAY ${VERSION_NAME}" --notes "RELAY ${VERSION_NAME} auto-update release."
fi

rm -rf "$TMP"
echo "Done. Installed apps will auto-update to ${VERSION_NAME} within ~10 minutes (or on next launch)."
echo "Manifest: https://github.com/${REPO}/releases/latest/download/version.json"
