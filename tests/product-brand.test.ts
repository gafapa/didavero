import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { productStoragePaths } from '../electron/storagePaths';

test('Didavero retains legacy installed and portable storage without moving user data', () => {
  const existing = new Set([path.join('settings', 'Apuntes IA'), path.join('documents', 'Apuntes IA'), path.join('usb', 'Apuntes IA datos')]);
  const installed = productStoragePaths('settings', 'documents', undefined, filename => existing.has(filename));
  assert.equal(installed.userData, path.join('settings', 'Apuntes IA'));
  assert.equal(installed.data, path.join('documents', 'Apuntes IA'));
  const portable = productStoragePaths('settings', 'documents', 'usb', filename => existing.has(filename));
  assert.equal(portable.userData, path.join('usb', 'Apuntes IA datos', '.electron'));
  assert.equal(portable.data, path.join('usb', 'Apuntes IA datos', 'apuntes'));
  const fresh = productStoragePaths('settings', 'documents', undefined, () => false);
  assert.equal(fresh.userData, path.join('settings', 'Didavero'));
  assert.equal(fresh.data, path.join('documents', 'Didavero'));
  assert.equal(productStoragePaths('settings', 'documents', 'usb', () => false).portable, path.join('usb', 'Didavero datos'));
});
