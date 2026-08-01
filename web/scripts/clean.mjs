import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
rmSync(resolve(scriptDirectory, '..', 'dist'), { recursive: true, force: true });
