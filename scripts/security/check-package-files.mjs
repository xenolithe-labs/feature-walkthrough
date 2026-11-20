// Fails when the unpacked npm package holds a file that should never be published: settings
// with credentials in them, keys, the local secret mapping, or source maps of the whole project.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
if (root === undefined) {
  console.error('usage: check-package-files.mjs <unpacked package folder>');
  process.exit(2);
}

const FORBIDDEN = [
  [/(^|\/)\.env(\.|$)/, 'an environment file'],
  [/(^|\/)\.npmrc$/, 'npm settings, which can hold a token'],
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, 'a key or certificate'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)/, 'an SSH key'],
  [/(^|\/)mapping\.tsv$/, 'the local secret mapping'],
  [/(^|\/)\.(git|github|claude)\//, 'a repository or tool folder'],
  [/(^|\/)(scripts|tests|src)\//, 'project sources, which the package does not ship'],
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield relative(root, path).split('\\').join('/');
  }
}

const files = [...walk(root)];
const problems = [];
for (const file of files) {
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(file)) problems.push(`${file}: ${what}`);
  }
}

if (problems.length > 0) {
  console.error(`The package holds ${problems.length} file(s) it must not:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`${files.length} files in the package, none of them private.`);
