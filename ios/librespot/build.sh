#!/bin/sh
# Builds the app's librespot (ios/README.md, "Librespot") for the iPhone: out/libwmp_librespot.a and
# out/wmp_librespot.h, which ios/project.yml links. Needs Xcode and rustup's aarch64-apple-ios target.
# `build.sh fetch` only prepares vendor/ (for a cargo check on another machine).
set -eu
cd "$(dirname "$0")"

# librespot-core 0.8.0 from crates.io, checked against its index checksum, with config.rs's OS
# constant made "linux" on iOS (Cargo.toml [patch.crates-io] says why).
core=vendor/librespot-core
if ! grep -q 'target_os = "ios"' "$core/src/config.rs" 2>/dev/null; then
  rm -rf vendor && mkdir vendor
  curl -fsSL https://static.crates.io/crates/librespot-core/librespot-core-0.8.0.crate -o vendor/core.crate
  echo "168bbe1c416980ddd9a969ebd6b50fb6c924eb1a3ded194285fa8ec0e2b1c68b  vendor/core.crate" | shasum -a 256 -c -
  tar xzf vendor/core.crate -C vendor && mv vendor/librespot-core-0.8.0 "$core"
  perl -pi -e 's/^pub const OS: &str = std::env::consts::OS;$/pub const OS: &str = if cfg!(target_os = "ios") { "linux" } else { std::env::consts::OS };/' "$core/src/config.rs"
  grep -q 'target_os = "ios"' "$core/src/config.rs"
fi
[ "${1:-}" = fetch ] && exit 0

# dns-sd's build script wants Avahi from pkg-config off macOS; pkgconfig/ answers it (the .pc says why).
export PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_PATH="$PWD/pkgconfig" IPHONEOS_DEPLOYMENT_TARGET=17.0
# native-static-libs: what the app has to link besides the library (project.yml's OTHER_LDFLAGS).
cargo rustc --release --target aarch64-apple-ios --lib -- --print native-static-libs
mkdir -p out
cp target/aarch64-apple-ios/release/libwmp_librespot.a wmp_librespot.h out/
ls -l out
