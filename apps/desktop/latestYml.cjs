'use strict';
// Writes release-ci/latest.yml: the update feed file electron-updater reads to find a new version.
// electron-builder only writes it when it publishes, and CI builds with `--publish never` (ship.mjs uploads the
// assets itself), so CI writes it here from the built installer. Usage: node latestYml.cjs <installer.exe> <version>
const { createHash } = require('node:crypto');
const { createReadStream, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** The latest.yml text for one installer, in electron-builder's own shape. */
function latestYml({ version, fileName, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');
}

/** Base64 SHA-512 of a file (the form electron-updater checks a download against). */
function sha512Of(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512');
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('base64')));
  });
}

async function main() {
  const [exe, version] = process.argv.slice(2);
  if (!exe || !version) throw new Error('usage: node latestYml.cjs <installer.exe> <version>');
  const text = latestYml({
    version,
    fileName: path.basename(exe),
    sha512: await sha512Of(exe),
    size: statSync(exe).size,
    releaseDate: new Date().toISOString(),
  });
  const out = path.join(path.dirname(exe), 'latest.yml');
  writeFileSync(out, text);
  process.stdout.write(text);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { latestYml, sha512Of };
