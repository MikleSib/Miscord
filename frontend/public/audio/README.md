# Miscord AI audio runtime

These runtime files are copied from `@sapphi-red/web-noise-suppressor@0.3.5`
and are loaded by `MiscordNoiseSuppressor` inside an `AudioWorklet`:

- `rnnoise-worklet.js` — Web Audio processor
- `rnnoise.wasm` — RNNoise WebAssembly binary
- `rnnoise-simd.wasm` — SIMD-optimized RNNoise WebAssembly binary

The wrapper package is MIT licensed. See `LICENSE-web-noise-suppressor.txt`.
RNNoise itself is maintained by Xiph.Org: https://github.com/xiph/rnnoise

To update these files, update the npm dependency and copy the matching artifacts
from `node_modules/@sapphi-red/web-noise-suppressor/dist` together. The worklet
and the WASM binaries must stay on compatible versions.
