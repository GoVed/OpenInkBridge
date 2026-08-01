import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

function read(relativePath) {
    return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function requiredMatch(value, pattern, description) {
    const match = value.match(pattern);
    if (!match) {
        throw new Error(`Could not read ${description}`);
    }
    return match[1];
}

function readGradleVersion(relativePath) {
    const contents = read(relativePath);
    const literal = contents.match(/^\s*versionName\s+["']([^"']+)["']/m);
    if (literal) return literal[1];

    const reference = contents.match(/^\s*versionName\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/m)?.[1];
    if (reference) {
        const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const assignment = contents.match(
            new RegExp(`^\\s*(?:def\\s+)?${escapedReference}\\s*=\\s*["']([^"']+)["']`, 'm')
        );
        if (assignment) return assignment[1];
    }

    throw new Error(`Could not read versionName from ${relativePath}`);
}

const versions = new Map([
    [
        'Cargo workspace',
        requiredMatch(
            read('Cargo.toml'),
            /^\s*version\s*=\s*["']([^"']+)["']/m,
            'workspace version from Cargo.toml'
        )
    ],
    ['Web package', JSON.parse(read('web/package.json')).version],
    ['Android sample', readGradleVersion('android/app/build.gradle')],
    ['Android SDK', readGradleVersion('android/openinkbridge-sdk/build.gradle')]
]);

const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size !== 1) {
    const details = [...versions].map(([name, version]) => `  ${name}: ${version}`).join('\n');
    throw new Error(`Release versions do not match:\n${details}`);
}

const [version] = uniqueVersions;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Version ${JSON.stringify(version)} is not valid semantic version syntax`);
}

const releaseTag = process.env.OPENINKBRIDGE_RELEASE_TAG?.trim();
if (releaseTag) {
    const expectedTag = `v${version}`;
    if (releaseTag !== expectedTag) {
        throw new Error(
            `Release tag ${JSON.stringify(releaseTag)} does not match the repository version; expected ${JSON.stringify(expectedTag)}`
        );
    }
    console.log(`Verified release tag ${releaseTag} and all platform versions.`);
} else {
    console.log(`Verified all platform versions: ${version}.`);
}
