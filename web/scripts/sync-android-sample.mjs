import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDirectory, '..');
const sourcePath = resolve(webRoot, 'dist', 'index.global.js');
const targetPath = resolve(webRoot, '..', 'android', 'app', 'src', 'main', 'assets', 'index.global.js');
const generated = await readFile(sourcePath, 'utf8');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
    const committed = await readFile(targetPath, 'utf8');
    if (generated !== committed) {
        throw new Error('Android sample bundle is stale; run npm run sync:android-sample after npm run build');
    }
    console.log('Android sample bundle matches the current web build.');
} else {
    await writeFile(targetPath, generated, 'utf8');
    console.log(`Updated ${targetPath}`);
}
