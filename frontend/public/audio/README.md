# Miscord AI audio runtimes

Miscord processes microphone audio locally in the browser through
`AudioWorklet` runtimes. Microphone audio is not uploaded for denoising.

## RNNoise runtime

The following files are exact copies from
`@sapphi-red/web-noise-suppressor@0.3.5`:

- `rnnoise-worklet.js` — Web Audio processor;
- `rnnoise.wasm` — RNNoise WebAssembly runtime;
- `rnnoise-simd.wasm` — the artifact used by the upstream SIMD URL. In package
  version `0.3.5` it is byte-identical to `rnnoise.wasm`.

The wrapper embeds WebAssembly produced by
`@shiguredo/rnnoise-wasm@2022.2.0`, built from
`shiguredo/rnnoise@2022.1.0`. Keep the worklet and both WASM files on the same
upstream version when updating.

Third-party terms distributed with these assets:

- `LICENSE-web-noise-suppressor.txt` — MIT license for the Web Audio wrapper;
- `LICENSE-rnnoise-wasm.txt` — Apache License 2.0 for the WASM wrapper/build;
- `LICENSE-rnnoise.txt` — BSD 3-Clause license for RNNoise and the generated
  WASM binary;
- `THIRD_PARTY_NOTICES.md` — exact versions, provenance, and integrity hashes.

## DeepFilterNet3 runtime

The `deepfilternet3/` directory contains the C/WASM runtime and model weights
used by the DeepFilterNet3 engine. Miscord distributes these artifacts under
the separate distribution license supplied by the project owner. Keep the
runtime, glue, worklet, and weights on the same licensed build when updating.

