import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'openinkbridge-web-package-'));
const consumerDirectory = join(temporaryDirectory, 'consumer');
const stagedWasmDirectory = resolve(webDirectory, 'generated', 'wasm');
const stagedSentinel = resolve(stagedWasmDirectory, 'openinkbridge_wasm_pack_smoke.js');
const distSentinel = resolve(webDirectory, 'dist', 'wasm', 'openinkbridge_wasm_pack_smoke.js');
const stagedWasmAlreadyExisted = existsSync(stagedWasmDirectory);

try {
    if (existsSync(stagedSentinel)) {
        throw new Error(`Refusing to overwrite existing smoke sentinel: ${stagedSentinel}`);
    }

    // A sentinel exercises the same preserve-and-copy path as wasm-pack output
    // without requiring the Rust toolchain for every package boundary test.
    mkdirSync(stagedWasmDirectory, { recursive: true });
    writeFileSync(stagedSentinel, 'export const packageSmokeSentinel = true;\n', 'utf8');

    runNpm(['pack', '--silent', '--pack-destination', temporaryDirectory], webDirectory);
    const tarballs = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'));
    if (tarballs.length !== 1) {
        throw new Error(`Expected one npm tarball, found ${tarballs.length}`);
    }

    mkdirSync(consumerDirectory, { recursive: true });
    writeFileSync(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({ name: 'openinkbridge-package-smoke', private: true, version: '1.0.0' }, null, 2),
        'utf8'
    );
    runNpm([
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(temporaryDirectory, tarballs[0])
    ], consumerDirectory);

    writeFileSync(join(consumerDirectory, 'smoke.cjs'), `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sdk = require('@openinkbridge/web');

assert.equal(typeof sdk.OpenInkBridgeCanvas, 'function');
assert.equal(typeof sdk.SDK_VERSION, 'string');
assert.equal(sdk.OpenInkBridgeCanvasComponent, undefined, 'React must not leak from the vanilla root');
assert.doesNotThrow(() => require.resolve('@openinkbridge/web/react'));
assert.equal(fs.existsSync(path.join(__dirname, 'node_modules', 'react')), false, 'optional React peer must not be installed');

const manifestPath = require.resolve('@openinkbridge/web/package.json');
const packageRoot = path.dirname(manifestPath);
assert.equal(fs.existsSync(path.join(packageRoot, 'dist', 'wasm', 'openinkbridge_wasm_pack_smoke.js')), true);
assert.equal(fs.readFileSync(path.join(packageRoot, 'dist', 'index.d.ts'), 'utf8').includes("from './react'"), false);

// Install a minimal local peer after proving the vanilla import works without it,
// then exercise the explicit React subpath without reaching a package registry.
const reactDirectory = path.join(__dirname, 'node_modules', 'react');
fs.mkdirSync(reactDirectory, { recursive: true });
fs.writeFileSync(path.join(reactDirectory, 'package.json'), JSON.stringify({ name: 'react', version: '18.3.1', main: 'index.js' }));
fs.writeFileSync(path.join(reactDirectory, 'index.js'), 'exports.useEffect = () => {}; exports.useRef = value => ({ current: value });');
fs.writeFileSync(path.join(reactDirectory, 'jsx-runtime.js'), 'exports.jsx = () => null; exports.jsxs = exports.jsx;');
const reactSdk = require('@openinkbridge/web/react');
assert.equal(typeof reactSdk.OpenInkBridgeCanvasComponent, 'function');
`, 'utf8');

    writeFileSync(join(consumerDirectory, 'smoke.mjs'), `
const sdk = await import('@openinkbridge/web');
if (typeof sdk.OpenInkBridgeCanvas !== 'function') {
    throw new Error('ES module import did not expose the vanilla SDK');
}
`, 'utf8');

    writeFileSync(join(consumerDirectory, 'smoke.ts'), `
import { OpenInkBridgeCanvas, SDK_VERSION } from '@openinkbridge/web';
const CanvasConstructor: typeof OpenInkBridgeCanvas = OpenInkBridgeCanvas;
const version: string = SDK_VERSION;
void CanvasConstructor;
void version;
`, 'utf8');

    run(process.execPath, ['smoke.cjs'], consumerDirectory);
    run(process.execPath, ['smoke.mjs'], consumerDirectory);
    run(process.execPath, [
        resolve(webDirectory, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'es2020',
        '--module',
        'commonjs',
        '--moduleResolution',
        'node',
        'smoke.ts'
    ], consumerDirectory);
    console.log(`Package smoke test passed: ${tarballs[0]}`);
} finally {
    rmSync(stagedSentinel, { force: true });
    rmSync(distSentinel, { force: true });
    if (!stagedWasmAlreadyExisted) {
        rmSync(stagedWasmDirectory, { recursive: true, force: true });
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
}

function runNpm(args, workingDirectory) {
    const npmCli = process.env.npm_execpath;
    if (npmCli) {
        run(process.execPath, [npmCli, ...args], workingDirectory);
        return;
    }
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, workingDirectory);
}

function run(command, args, workingDirectory) {
    const result = spawnSync(command, args, {
        cwd: workingDirectory,
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error([
            `${command} ${args.join(' ')} failed with exit code ${result.status}`,
            result.stdout,
            result.stderr
        ].filter(Boolean).join('\n'));
    }
}
