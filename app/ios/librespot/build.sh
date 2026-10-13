#!/bin/sh
# Builds the app's librespot (ios/README.md, "Librespot") for the iPhone: out/libwmp_librespot.a and
# out/wmp_librespot.h, which ios/project.yml links. Needs Xcode and rustup's aarch64-apple-ios target.
# `build.sh fetch` only prepares vendor/ (for a cargo check on another machine).
set -eu
cd "$(dirname "$0")"

# librespot-core 0.8.0 from crates.io, checked against its index checksum, with core.patch applied
# (the OS constant "linux" on iOS, Cargo.toml [patch.crates-io] says why; token setters, src/lib.rs says why).
core=vendor/librespot-core
if ! grep -q 'set_auth_token' "$core/src/login5.rs" 2>/dev/null; then
  rm -rf vendor && mkdir vendor
  curl -fsSL https://static.crates.io/crates/librespot-core/librespot-core-0.8.0.crate -o vendor/core.crate
  echo "168bbe1c416980ddd9a969ebd6b50fb6c924eb1a3ded194285fa8ec0e2b1c68b  vendor/core.crate" | shasum -a 256 -c -
  tar xzf vendor/core.crate -C vendor && mv vendor/librespot-core-0.8.0 "$core"
  patch -p1 -d "$core" < core.patch
  grep -q 'target_os = "ios"' "$core/src/config.rs"
fi
# librespot-playback and librespot-audio 0.8.0 the same way, with playback.patch (Player::keep_position,
# src/lib.rs says why; the buffer line) and audio.patch (what that line reads).
audio=vendor/librespot-audio
if ! grep -q 'pub fn ahead' "$audio/src/fetch/mod.rs" 2>/dev/null; then
  rm -rf "$audio"
  curl -fsSL https://static.crates.io/crates/librespot-audio/librespot-audio-0.8.0.crate -o vendor/audio.crate
  echo "b3fe76acb49f58165484303edf0e7bd778f0e6d96f5c59e9d6b6fde1a90d36ff  vendor/audio.crate" | shasum -a 256 -c -
  tar xzf vendor/audio.crate -C vendor && mv vendor/librespot-audio-0.8.0 "$audio"
  patch -p1 -d "$audio" < audio.patch
fi
playback=vendor/librespot-playback
if ! grep -q 'HEALTH_AT' "$playback/src/player.rs" 2>/dev/null; then
  rm -rf "$playback"
  curl -fsSL https://static.crates.io/crates/librespot-playback/librespot-playback-0.8.0.crate -o vendor/playback.crate
  echo "88258620bf3e6808ea1fadd11639648d77c06280b9f5a4c9d14ea79f6f998af6  vendor/playback.crate" | shasum -a 256 -c -
  tar xzf vendor/playback.crate -C vendor && mv vendor/librespot-playback-0.8.0 "$playback"
  patch -p1 -d "$playback" < playback.patch
fi
[ "${1:-}" = fetch ] && exit 0

# dns-sd's build script wants Avahi from pkg-config off macOS; pkgconfig/ answers it (the .pc says why).
export PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_PATH="$PWD/pkgconfig" IPHONEOS_DEPLOYMENT_TARGET=17.0
# native-static-libs: what the app has to link besides the library (project.yml's OTHER_LDFLAGS).
cargo rustc --release --target aarch64-apple-ios --lib -- --print native-static-libs
mkdir -p out
cp target/aarch64-apple-ios/release/libwmp_librespot.a wmp_librespot.h out/
ls -l out
