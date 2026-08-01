import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const coreDirectory = resolve(webDirectory, '..', 'core');
// Keep explicitly generated bindings outside dist. Normal builds may clean dist,
// and sync-wasm.mjs copies this durable staging tree into release artifacts.
const outputDirectory = resolve(webDirectory, 'generated', 'wasm');
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const executable = process.platform === 'win32' ? 'wasm-pack.exe' : 'wasm-pack';
const result = spawnSync(executable, [
    'build',
    coreDirectory,
    '--target',
    'web',
    '--out-dir',
    outputDirectory,
    '--out-name',
    'openinkbridge_core',
    '--',
    '--features',
    'wasm'
], { stdio: 'inherit' });

if (result.error?.code === 'ENOENT') {
    console.error('wasm-pack was not found. Install it from https://rustwasm.github.io/wasm-pack/installer/.');
    process.exit(1);
}

process.exit(result.status ?? 1);
