import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const generatedBundle = resolve(repositoryRoot, 'web', 'dist', 'index.global.js');
const sampleBundle = resolve(repositoryRoot, 'android', 'app', 'src', 'main', 'assets', 'index.global.js');

for (const path of [generatedBundle, sampleBundle]) {
    if (!existsSync(path)) {
        throw new Error(`Required sample-sync input does not exist: ${path}`);
    }
}

function normalizedText(path) {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

const generated = normalizedText(generatedBundle);
const sample = normalizedText(sampleBundle);

if (generated !== sample) {
    throw new Error(
        [
            'The Android sample Web bundle is stale.',
            `  generated web/dist/index.global.js: ${sha256(generated)}`,
            `  tracked android asset:             ${sha256(sample)}`,
            'Run the Web build and update android/app/src/main/assets/index.global.js intentionally.'
        ].join('\n')
    );
}

console.log(`Verified Android sample Web bundle: ${sha256(generated)}.`);
