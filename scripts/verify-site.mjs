import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('output/didavero-site');
const config = JSON.parse(await fs.readFile('website/site.config.json', 'utf8'));
const files = await fs.readdir(root, { recursive: true });
const html = files.filter(filename => filename.endsWith('.html'));
const failures = [];
for (const filename of html) {
  const content = await fs.readFile(path.join(root, filename), 'utf8');
  if ((content.match(/<h1\b/g) ?? []).length !== 1) failures.push(`${filename}: expected one h1`);
  if (!content.includes('Content-Security-Policy') || !content.includes("connect-src 'none'")) failures.push(`${filename}: restrictive CSP missing`);
  if (/fonts\.googleapis|googletagmanager|google-analytics|<iframe\b/.test(content)) failures.push(`${filename}: unexpected third-party embed`);
  if (!/<html lang="(?:es|en)">/.test(content)) failures.push(`${filename}: language missing`);
  for (const [, reference] of content.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
    if (!reference.startsWith('/')) continue;
    const target = path.join(root, reference.split('#')[0], reference.endsWith('/') ? 'index.html' : '');
    try { await fs.access(target); } catch { failures.push(`${filename}: missing ${reference}`); }
  }
}
for (const language of ['', 'en/']) for (const slug of ['legal', 'privacy', 'cookies', 'ai', 'terms', 'contact', 'accessibility']) {
  const content = await fs.readFile(path.join(root, language, slug, 'index.html'), 'utf8');
  if (!content.includes(`href="/${language}contact/"`)) failures.push(`${language}${slug}: contact route missing`);
}
const script = await fs.readFile(path.join(root, 'assets/site.js'), 'utf8');
if (/localStorage|sessionStorage|document\.cookie|\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(script)) failures.push('Unexpected storage or network code in website script');
const privacy = await fs.readFile(path.join(root, 'privacy/index.html'), 'utf8');
for (const expected of [config.owner.name, config.owner.taxId, config.owner.address, 'Frankfurt', '30 rotaciones']) {
  if (!privacy.toLowerCase().includes(expected.toLowerCase())) failures.push(`Privacy information missing: ${expected}`);
}
if (config.previewDownload) {
  const artifact = await fs.readFile(path.join(root, config.previewDownload.path));
  if (createHash('sha256').update(artifact).digest('hex') !== config.previewDownload.sha256) failures.push('Published installer checksum mismatch');
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Verified ${html.length} pages, local assets, legal routes, privacy controls and installer checksum.`);
