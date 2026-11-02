import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('patched packaging matchers preserve ASAR unpacking and directory include/exclude filters', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'didavero-packaging-dependencies-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'first'), second = path.join(directory, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.writeFile(path.join(first, 'included.txt'), 'left');
  await fs.writeFile(path.join(second, 'included.txt'), 'right');
  await fs.writeFile(path.join(first, 'ignored.txt'), 'ignored left');
  await fs.writeFile(path.join(second, 'ignored.txt'), 'ignored right');
  const comparison = require('dir-compare').compareSync(first, second, { compareContent: true, includeFilter: '*.txt', excludeFilter: 'ignored*' });
  assert.equal(comparison.differences, 1);
  const archive = path.join(directory, 'application.asar');
  const asar = require('@electron/asar');
  await asar.createPackageWithOptions(first, archive, { unpack: '*.txt' });
  assert.ok(asar.listPackage(archive).some((entry: string) => entry.replaceAll('\\', '/') === '/included.txt'), 'The archive must contain the actual application files');
  assert.equal(await fs.readFile(archive + '.unpacked/included.txt', 'utf8'), 'left');
  assert.equal(asar.extractFile(archive, 'included.txt').toString(), 'left');
});
