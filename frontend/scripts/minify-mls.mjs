import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { transform } from 'esbuild';

const sourcePath = resolve('public/crypto/mls/miscord_mls.js');
const temporaryPath = `${sourcePath}.tmp`;
const source = await readFile(sourcePath, 'utf8');
const result = await transform(source, {
  format: 'esm',
  legalComments: 'inline',
  minify: true,
  target: ['es2022'],
});

await writeFile(temporaryPath, result.code, 'utf8');
await rename(temporaryPath, sourcePath);
