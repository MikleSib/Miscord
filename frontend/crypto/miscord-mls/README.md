# Miscord MLS WebAssembly

This crate is the browser MLS state machine for encrypted group voice. It pins
OpenMLS and its crypto provider so protocol changes remain explicit and
reviewable.

Rebuild the checked-in browser artifact from the repository root:

```powershell
cd frontend/crypto/miscord-mls
wasm-pack build --target web --release --out-dir ../../public/crypto/mls
Remove-Item ../../public/crypto/mls/.gitignore
cd ../..
npm run minify:mls
```

The generated JavaScript is mechanically minified to keep generated code below
the repository's 600-line file limit. Cryptographic logic belongs in
`src/lib.rs`; do not edit the generated files directly.
