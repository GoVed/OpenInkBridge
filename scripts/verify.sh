#!/usr/bin/env sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-features

node scripts/verify-versions.mjs

cd web
npm ci
npm test
node ../scripts/verify-sample-sync.mjs
npm pack --dry-run --ignore-scripts
cd ..

if [ "${SKIP_ANDROID:-0}" != "1" ]; then
    cd android
    chmod +x gradlew
    ./gradlew --no-daemon --stacktrace testDebugUnitTest lintDebug assembleDebug
fi
