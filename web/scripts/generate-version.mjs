import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, '..');
const packageMetadata = JSON.parse(readFileSync(resolve(webDirectory, 'package.json'), 'utf8'));
const outputDirectory = resolve(webDirectory, 'src', 'generated');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
    resolve(outputDirectory, 'version.ts'),
    `// Generated from package.json by scripts/generate-version.mjs.\nexport const SDK_VERSION = ${JSON.stringify(packageMetadata.version)};\n`,
    'utf8'
);
