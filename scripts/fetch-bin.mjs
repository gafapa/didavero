// Descarga Pandoc y Typst (binarios únicos) para incluirlos en el instalador.
// Uso: node scripts/fetch-bin.mjs [win|mac|linux]   (por defecto, el sistema actual)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256, verifyAssetDigest } from './asset-integrity.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const plataforma = args.find(argument => argument !== '--check' && argument !== '--') ?? { win32: 'win', darwin: 'mac' }[process.platform] ?? 'linux';
if (!['win', 'mac', 'linux'].includes(plataforma)) throw new Error('Unsupported binary platform');
const destino = path.resolve('resources-bin', plataforma);
const exe = plataforma === 'win' ? '.exe' : '';

const PROGRAMAS = [
  {
    nombre: 'pandoc',
    repo: 'jgm/pandoc',
    licencia: 'https://raw.githubusercontent.com/jgm/pandoc/main/COPYRIGHT',
    recurso: {
      win: /windows-x86_64\.zip$/,
      mac: /arm64-macOS\.zip$/,
      linux: /linux-amd64\.tar\.gz$/,
    }[plataforma],
  },
  {
    nombre: 'typst',
    repo: 'typst/typst',
    licencia: 'https://raw.githubusercontent.com/typst/typst/main/LICENSE',
    recurso: {
      win: /x86_64-pc-windows-msvc\.zip$/,
      mac: /aarch64-apple-darwin\.tar\.xz$/,
      linux: /x86_64-unknown-linux-musl\.tar\.xz$/,
    }[plataforma],
  },
];

async function descargar(url, archivo, digest) {
  const r = await fetch(url, { headers: { 'User-Agent': 'apuntes-ia-build' }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  if (digest !== undefined) verifyAssetDigest(data, digest);
  fs.writeFileSync(archivo, data);
}

/** Busca un archivo por nombre dentro de un directorio (recursivo). */
function buscar(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = buscar(p, nombre);
      if (r) return r;
    } else if (e.name === nombre) return p;
  }
}

fs.mkdirSync(destino, { recursive: true });
const versiones = {};

for (const prog of PROGRAMAS) {
  const final = path.join(destino, prog.nombre + exe);
  const manifestFile = path.join(destino, `${prog.nombre}.integrity.json`);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {}
  const cacheVerified = manifest && fs.existsSync(final) && sha256(fs.readFileSync(final)) === manifest.binarySha256;
  if (checkOnly) {
    if (!cacheVerified) throw new Error(`The cached ${prog.nombre} binary has no valid integrity manifest`);
    console.log(`${prog.nombre} ${manifest.version}: SHA-256 verified`);
    continue;
  }
  // Con token (en GitHub Actions) para no chocar con el límite de la API sin autenticar
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const respuesta = await fetch(`https://api.github.com/repos/${prog.repo}/releases/latest`, {
    headers: { 'User-Agent': 'apuntes-ia-build', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!respuesta.ok) throw new Error(`GitHub API (${prog.repo}): ${respuesta.status} ${await respuesta.text()}`);
  const rel = await respuesta.json();
  versiones[prog.nombre] = rel.tag_name;
  if (cacheVerified && manifest.version === rel.tag_name) {
    console.log(`${prog.nombre} ${rel.tag_name} ya descargado`);
    continue;
  }
  const recurso = rel.assets?.find((a) => prog.recurso.test(a.name));
  if (!recurso) throw new Error(`No se encuentra el binario de ${prog.nombre} para ${plataforma}`);
  console.log(`Descargando ${recurso.name}…`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `apuntes-${prog.nombre}-`));
  const comprimido = path.join(tmp, recurso.name);
  if (!recurso.digest) throw new Error(`No SHA-256 digest is available for ${recurso.name}`);
  try {
  await descargar(recurso.browser_download_url, comprimido, recurso.digest);
  // bsdtar (incluido en Windows 10+ y macOS) descomprime zip, tar.gz y tar.xz
  // En Windows se usa el tar del sistema: el de Git Bash no entiende rutas "C:\..."
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', comprimido, '-C', tmp]);
  const binario = buscar(tmp, prog.nombre + exe);
  if (!binario) throw new Error(`No se encuentra ${prog.nombre}${exe} dentro de ${recurso.name}`);
  const replacement = `${final}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(binario, replacement);
    if (!exe) fs.chmodSync(replacement, 0o755);
    fs.renameSync(replacement, final);
  } finally { fs.rmSync(replacement, { force: true }); }
  await descargar(prog.licencia, path.join(destino, `LICENCIA-${prog.nombre}.txt`));
  for (const f of fs.readdirSync(destino)) if (f.startsWith(`.${prog.nombre}-`)) fs.rmSync(path.join(destino, f));
  fs.writeFileSync(path.join(destino, `.${prog.nombre}-${rel.tag_name}`), '');
  fs.writeFileSync(manifestFile, JSON.stringify({ version: rel.tag_name, asset: recurso.name, archiveSha256: recurso.digest.slice(7), binarySha256: sha256(fs.readFileSync(final)) }, null, 2) + '\n');
  } finally {
    const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(tmp).startsWith(temporaryRoot) || !path.basename(tmp).startsWith(`apuntes-${prog.nombre}-`)) throw new Error('Unsafe temporary cleanup path');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('Binarios listos en', destino, versiones);
