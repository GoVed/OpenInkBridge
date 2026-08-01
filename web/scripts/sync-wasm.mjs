import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const sourceDirectory = resolve(webDirectory, 'generated', 'wasm');
const destinationDirectory = resolve(webDirectory, 'dist', 'wasm');

rmSync(destinationDirectory, { recursive: true, force: true });
if (existsSync(sourceDirectory)) {
    mkdirSync(dirname(destinationDirectory), { recursive: true });
    cpSync(sourceDirectory, destinationDirectory, { recursive: true });
}
