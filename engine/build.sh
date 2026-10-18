#!/usr/bin/env bash
# Builds docs/engine.wasm from engine/engine.cpp with clang and wasi-libc (for libm only).
# Ubuntu/Debian/WSL:  sudo apt install clang lld wasi-libc libclang-rt-18-dev-wasm32
# Run from the project folder:  bash engine/build.sh
set -euo pipefail
SYSROOT_INC=${WASI_INCLUDE:-/usr/include/wasm32-wasi}
SYSROOT_LIB=${WASI_LIB:-/usr/lib/wasm32-wasi}
clang++ --target=wasm32-wasi -isystem "$SYSROOT_INC" -L"$SYSROOT_LIB" \
  -O3 -flto -std=c++17 -nostartfiles -nostdlib++ -fno-exceptions -fno-rtti \
  -Wl,--no-entry -Wl,--strip-all -Wl,--lto-O3 \
  -o docs/engine.wasm engine/engine.cpp -lm
echo "Built docs/engine.wasm ($(wc -c < docs/engine.wasm) bytes)"
