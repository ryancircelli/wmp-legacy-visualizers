#!/bin/sh
# Rebuilds native/webview.dll: webview 0.12.0 (the C library the host's webview_ffi.ts binds) with
# MinGW-w64, the C++ runtime linked in, so the DLL imports only what Windows itself ships. The
# release DLLs of webview_deno are MSVC /MD builds that need the Visual C++ Redistributable
# (MSVCP140, VCRUNTIME140, VCRUNTIME140_1), which a freshly installed Windows does not have: the
# host's window flashed and the process died loading the DLL. main_test.ts guards the imports.
#
# Needs x86_64-w64-mingw32-g++ (Debian/Ubuntu: g++-mingw-w64-x86-64-win32), git, curl, unzip.
set -eu
WEBVIEW_TAG=0.12.0                     # commit 3ab4b5d722438fc8a13e6ca830c5e2372d19a01d
WEBVIEW2_SDK=1.0.1150.38               # the version webview 0.12.0's CMake fetches
WEBVIEW2_SHA256=921c004bd1764b585496b2eb3eec0a59a9a98e698246f1d9a3f1c08d1d84ebd5
OUT=$(cd "$(dirname "$0")" && pwd)/webview.dll
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
git clone -q --depth 1 --branch "$WEBVIEW_TAG" https://github.com/webview/webview "$T/webview"
curl -sfL -o "$T/sdk.nupkg" "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WEBVIEW2_SDK"
echo "$WEBVIEW2_SHA256  $T/sdk.nupkg" | sha256sum -c -
unzip -q "$T/sdk.nupkg" 'build/native/include/*' -d "$T/sdk"
cd "$T/webview"
x86_64-w64-mingw32-g++ -std=c++14 -O2 -shared -s -DNDEBUG -DWEBVIEW_BUILD_SHARED \
  -Icore/include -Icompatibility/mingw/include -I"$T/sdk/build/native/include" \
  core/src/webview.cc -o "$OUT" \
  -static -static-libgcc -static-libstdc++ \
  -ladvapi32 -lole32 -lshell32 -lshlwapi -luser32 -lversion
echo "built $OUT"
