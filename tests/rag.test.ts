// Índice de las fuentes (RAG): búsqueda, filtro por archivo y caché del índice en memoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buscar, indexar } from '../server/rag';
import MiniSearch from 'minisearch';

const parrafo = (i: number, tema: string) => `Párrafo ${i} sobre ${tema}. ${'Texto de relleno con palabras variadas para el índice. '.repeat(6)}`;

test('busca en las fuentes, filtra por archivo y ve los cambios al reindexar', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-rag-'));
  try {
    await fs.writeFile(path.join(dir, 'celula.md'), ['# La célula', ...Array.from({ length: 40 }, (_, i) => parrafo(i, i === 7 ? 'el cloroplasto y la fotosíntesis' : 'la membrana'))].join('\n\n'));
    await fs.writeFile(path.join(dir, 'tejidos.md'), ['# Tejidos', ...Array.from({ length: 40 }, (_, i) => parrafo(i, i === 3 ? 'el parénquima clorofílico y la fotosíntesis' : 'el xilema'))].join('\n\n'));
    const info = await indexar(dir);
    assert.deepEqual(info.map((i) => i.estado), ['indexado', 'indexado']);
    const carpetas = { documento: dir };

    const r = await buscar(carpetas, 'fotosíntesis', 2);
    assert.equal(r.length, 2);
    assert.deepEqual(new Set(r.map((x) => x.archivo)), new Set(['celula.md', 'tejidos.md']));
    assert.ok(r.every((x) => x.texto.includes('fotosíntesis') && x.carpeta === 'documento'));

    // Solo en un archivo
    const solo = await buscar(carpetas, 'fotosíntesis', 5, 'tejidos.md');
    assert.ok(solo.length >= 1 && solo.every((x) => x.archivo === 'tejidos.md'));
    assert.match(solo[0].texto, /parénquima/);

    // La segunda búsqueda reutiliza el índice y da lo mismo
    assert.deepEqual(await buscar(carpetas, 'fotosíntesis', 2), r);

    // Un archivo nuevo aparece al reindexar
    await fs.writeFile(path.join(dir, 'virus.md'), ['# Virus', parrafo(0, 'los bacteriófagos'), parrafo(1, 'la cápside')].join('\n\n'));
    await indexar(dir);
    assert.equal((await buscar(carpetas, 'bacteriófagos', 3))[0]?.archivo, 'virus.md');

    // Y uno borrado deja de aparecer
    await fs.rm(path.join(dir, 'celula.md'));
    await indexar(dir);
    assert.ok((await buscar(carpetas, 'cloroplasto', 5)).every((x) => x.archivo !== 'celula.md'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Concurrent cold source searches share one index and keep their source labels', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'apuntes-rag-concurrent-'));
  context.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'fixture.md'),'# Fictional protocol\n\n'+parrafo(1,'protocolo de comunicaciones'));
  await indexar(directory);
  let builds = 0;
  const original = MiniSearch.prototype.addAll;
  context.mock.method(MiniSearch.prototype,'addAll',function (documents) { builds++; return original.call(this,documents); });
  const results = await Promise.all(Array.from({length:12},()=>buscar({documento:directory},'protocolo')));
  assert.equal(builds,1);
  assert.ok(results.every(result=>result[0].carpeta==='documento'));
  assert.equal((await buscar({asignatura:directory},'protocolo'))[0].carpeta,'asignatura');
  const cacheFile = path.join(directory,'.indice','fixture.md.json');
  const cache = JSON.parse(await fs.readFile(cacheFile,'utf8'));
  cache.fragmentos[0].texto = 'Fictional external cache update with xenobotanical evidence.';
  await fs.writeFile(cacheFile,JSON.stringify(cache));
  assert.match((await buscar({documento:directory},'xenobotanical'))[0].texto,/external cache update/);
});

test('indexing deduplicates concurrent extraction, rebuilds corrupt caches and tolerates a deleted source before stat', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-rag-recovery-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'fixture.md'), '# Fictional source\n\nPhotosynthesis fixture.');
  const first = indexar(directory), second = indexar(directory);
  assert.equal(first, second); await first;
  const cache = path.join(directory, '.indice', 'fixture.md.json');
  for (const damaged of ['{broken', '{}']) {
    await fs.writeFile(cache, damaged);
    assert.equal((await indexar(directory))[0].estado, 'indexado');
    assert.ok(JSON.parse(await fs.readFile(cache, 'utf8')).fragmentos.length > 0);
  }
  const original = fs.stat;
  let removed = false;
  context.mock.method(fs, 'stat', async (filename: Parameters<typeof fs.stat>[0], ...args: any[]) => {
    if (!removed && String(filename) === path.join(directory, 'fixture.md')) { removed = true; await fs.unlink(String(filename)); }
    return (original as any)(filename, ...args);
  });
  assert.deepEqual(await indexar(directory), []);
  assert.equal(removed, true);
  await assert.rejects(fs.readFile(cache), /ENOENT/);
});
