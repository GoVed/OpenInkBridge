import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
rmSync(resolve(webDirectory, 'dist'), { recursive: true, force: true });

if (process.argv.includes('--wasm')) {
    rmSync(resolve(webDirectory, 'generated', 'wasm'), { recursive: true, force: true });
}
