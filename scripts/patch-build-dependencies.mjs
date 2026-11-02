// Preserve legacy build-tool call sites while using the patched minimatch API.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const original = 'const minimatch_1 = __importDefault(require("minimatch"));';
const replacement = 'const minimatch_1 = { default: require("minimatch").minimatch };';
const targets = [
  { name: 'dir-compare', version: '4.2.0', file: 'build/src/FilterHandler/defaultFilterHandler.js' },
];
for (const target of targets) {
  let manifest;
  try { manifest = require.resolve(`${target.name}/package.json`); }
  catch (error) { if (error.code === 'MODULE_NOT_FOUND') continue; throw error; }
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (metadata.version !== target.version) throw new Error(`Requalify the minimatch adapter for ${target.name}@${metadata.version}.`);
  const filename = path.join(path.dirname(manifest), target.file);
  const content = fs.readFileSync(filename, 'utf8');
  if (content.includes(replacement)) continue;
  if (content.split(original).length !== 2) throw new Error(`Unexpected minimatch import in ${target.name}; refusing to patch.`);
  fs.writeFileSync(filename, content.replace(original, replacement));
  console.log(`Adapted ${target.name}@${target.version} to the patched minimatch API.`);
}
