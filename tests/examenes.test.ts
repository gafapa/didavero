// Exámenes de la asignatura: material (documentos y archivos propios), resultado de la IA,
// puntuación, textos del examen, del solucionario y de la rúbrica, y papelera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { Flujo } from '../server/flujo';
import { listarPapelera, restaurarDePapelera } from '../server/gestion';
import {
  ajustarPuntos,
  ajustarRubrica,
  examenAMarkdown,
  rubricaAMarkdown,
  solucionarioAMarkdown,
  sumaPuntos,
  type PreguntaExamen,
} from '../shared/examenes';

test('reparte la puntuación en cuartos de punto y ajusta la rúbrica a la pregunta', () => {
  const p = ajustarPuntos([{ puntos: 1 }, { puntos: 1 }, { puntos: 1 }], 10);
  assert.equal(sumaPuntos(p), 10);
  assert.ok(p.every((x) => (x.puntos * 4) % 1 === 0));
  assert.deepEqual(ajustarPuntos([{ puntos: 0 }, { puntos: 0 }], 3).map((x) => x.puntos), [1.5, 1.5]);

  const q = ajustarRubrica({
    id: 'x',
    tipo: 'desarrollo',
    enunciado: 'Explica',
    puntos: 3,
    rubrica: [
      { criterio: 'A', puntos: 1, niveles: [{ nivel: 'Excelente', descripcion: '', puntos: 1 }, { nivel: 'No lo hace', descripcion: '', puntos: 0 }] },
      { criterio: 'B', puntos: 1, niveles: [{ nivel: 'Excelente', descripcion: '', puntos: 1 }, { nivel: 'No lo hace', descripcion: '', puntos: 0 }] },
    ],
  });
  assert.equal(sumaPuntos(q.rubrica!), 3);
  assert.equal(q.rubrica![0].niveles[0].puntos, q.rubrica![0].puntos);
});

test('prepara un examen con documentos y archivos propios, lo procesa y lo recupera de la papelera', async (context) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-examenes-'));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  const almacen = new Almacen(path.join(dir, 'datos'));
  await almacen.iniciar();
  const asig = await almacen.crearAsignatura({ nombre: 'Biología ficticia' });
  const doc = await almacen.crearDocumento(asig.id, { titulo: 'La célula' });
  const [seccion] = await almacen.listarSecciones(asig.id, doc.id).then(async (l) => (l.length ? l : [await almacen.crearSeccion(asig.id, doc.id, 'Orgánulos')]));
  await almacen.guardarSeccion(asig.id, doc.id, seccion.archivo, `# Orgánulos\n\n${'La mitocondria produce energía en forma de ATP mediante la respiración celular. '.repeat(8)}`);
  const cola = new Cola(1, path.join(dir, 'trabajos'));
  const flujo = new Flujo({
    almacen: () => almacen,
    cola,
    ajustes: () => ({ carpetaDatos: almacen.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }),
    motoresListos: () => new Set(),
  });
  // No se lanza ningún agente: se guarda lo que se le pediría
  const lanzados: any[] = [];
  (flujo as any).lanzar = async (l: unknown) => {
    lanzados.push(l);
    return { id: `t${lanzados.length}` };
  };

  const ex = await flujo.crearExamen(asig.id, { titulo: 'Examen del tema 1' });
  assert.equal(ex.estado, 'borrador');
  assert.deepEqual(ex.opciones.documentos, [{ id: doc.id, secciones: [] }]);
  assert.notEqual(ex.opciones.espacio, true);
  await flujo.editarExamen(asig.id, ex.id, { opciones: { espacio: true } });
  assert.equal((await flujo.examen(asig.id, ex.id)).opciones.espacio, true);
  await flujo.editarExamen(asig.id, ex.id, { opciones: { duracion: 45 } });
  assert.equal((await flujo.examen(asig.id, ex.id)).opciones.espacio, true);
  await flujo.editarExamen(asig.id, ex.id, { opciones: { espacio: false } });
  assert.equal((await flujo.examen(asig.id, ex.id)).opciones.espacio, false);
  // Archivos subidos solo para el examen: uno con texto y una imagen (la IA tendrá que abrirla)
  await fs.writeFile(await flujo.rutaFuenteExamen(asig.id, ex.id, 'apuntes-profesor.md'), `# Ribosomas\n\n${'Los ribosomas sintetizan proteínas a partir del ARN mensajero. '.repeat(6)}`);
  await fs.writeFile(await flujo.rutaFuenteExamen(asig.id, ex.id, 'pizarra.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const fuentes = await flujo.fuentesExamen(asig.id, ex.id);
  assert.deepEqual(fuentes.map((f) => f.nombre), ['apuntes-profesor.md', 'pizarra.png']);

  await flujo.generarExamen(asig.id, ex.id, { tipos: { test: 2, desarrollo: 1 }, total: 10, duracion: 50 });
  const l = lanzados[0];
  assert.equal(l.agente, 'examinador');
  assert.equal(l.paso, 'examen');
  assert.match(l.tarea, /La mitocondria produce energía/); // la sección, ya incluida
  assert.match(l.tarea, /Los ribosomas sintetizan proteínas/); // el archivo propio, ya incluido
  assert.match(l.tarea, new RegExp(`examenes/${ex.id}/fuentes/pizarra\\.png`)); // sin texto: la abre el agente
  assert.ok(l.carpetas.examen.endsWith(path.join(ex.id, 'fuentes')));
  assert.equal((await flujo.examen(asig.id, ex.id)).estado, 'generando');
  await assert.rejects(flujo.generarExamen(asig.id, ex.id), /ya se está generando/);

  // Resultado de la IA: puntos que no suman 10, una pregunta mal formada y una rúbrica que no cuadra
  const salida = l.post.datos.salida as string;
  await fs.mkdir(path.dirname(path.join(almacen.dirAsignatura(asig.id), salida)), { recursive: true });
  await fs.writeFile(
    path.join(almacen.dirAsignatura(asig.id), salida),
    JSON.stringify({
      preguntas: [
        { tipo: 'test', puntos: 1, enunciado: '¿Qué orgánulo produce ATP?', opciones: ['Ribosoma', 'Mitocondria', 'Núcleo', 'Vacuola'], correcta: 1, explicacion: 'La respiración celular.' },
        { tipo: 'test', puntos: 1, enunciado: '¿Qué sintetizan los ribosomas?', opciones: ['Lípidos', 'Proteínas'], correcta: 1 },
        { tipo: 'test', puntos: 1, enunciado: 'Mal formada', opciones: ['Sola'], correcta: 3 },
        {
          tipo: 'desarrollo',
          puntos: 4,
          enunciado: 'Explica la función de la mitocondria.',
          solucion: 'La mitocondria realiza la respiración celular y produce ATP.',
          rubrica: [
            {
              criterio: 'Función',
              puntos: 2,
              niveles: [
                { nivel: 'Excelente', descripcion: 'Explica la respiración y el ATP', puntos: 2 },
                { nivel: 'Adecuado', descripcion: 'Solo el ATP', puntos: 1 },
                { nivel: 'Insuficiente', descripcion: 'Confusa', puntos: 0.5 },
                { nivel: 'No lo hace', descripcion: 'No responde', puntos: 0 },
              ],
            },
          ],
          errores: ['Confundirla con el cloroplasto (−0,5)'],
          criterios: ['1.2'],
        },
      ],
    }),
  );
  const mensaje = await (flujo as any).postExamen({ asignatura: asig.id }, l.post.datos);
  assert.match(mensaje, /3 preguntas \(1 descartadas/);
  const listo = await flujo.examen(asig.id, ex.id);
  assert.equal(listo.estado, 'listo');
  assert.equal(sumaPuntos(listo.preguntas), 10);
  const desarrollo = listo.preguntas.find((p) => p.tipo === 'desarrollo')!;
  assert.equal(sumaPuntos(desarrollo.rubrica!), desarrollo.puntos);

  // Textos: el examen no lleva las respuestas; el solucionario y la rúbrica, sí
  const enunciado = examenAMarkdown(listo);
  assert.match(enunciado, /Nombre y apellidos/);
  assert.match(enunciado, /\*\*Duración:\*\* 50 minutos/);
  assert.doesNotMatch(enunciado, /respiración celular y produce ATP/);
  assert.match(solucionarioAMarkdown(listo), /\*\*Respuesta:\*\* b\) Mitocondria/);
  assert.match(solucionarioAMarkdown(listo), /respiración celular y produce ATP/);
  const rubrica = rubricaAMarkdown(listo);
  assert.match(rubrica, /\| Criterio \| Excelente \| Adecuado \| Insuficiente \| No lo hace \|/);
  assert.match(rubrica, /Criterios de evaluación/);
  assert.match(rubrica, /Confundirla con el cloroplasto/);

  // Rehacer una pregunta: la nueva conserva los puntos de la anterior
  const primera = listo.preguntas[0];
  await flujo.pedirPreguntaExamen(asig.id, ex.id, { preguntaId: primera.id, indicaciones: 'Más difícil' });
  const l2 = lanzados[1];
  assert.match(l2.tarea, /Rehaz la pregunta 1/);
  await fs.writeFile(
    path.join(almacen.dirAsignatura(asig.id), l2.post.datos.salida),
    JSON.stringify({ pregunta: { puntos: 9, enunciado: '¿Dónde se produce el ATP?', opciones: ['Citoplasma', 'Mitocondria'], correcta: 1 } }),
  );
  await (flujo as any).postPreguntaExamen({ asignatura: asig.id }, l2.post.datos);
  const rehecho = await flujo.examen(asig.id, ex.id);
  assert.equal(rehecho.preguntas[0].id, primera.id);
  assert.equal(rehecho.preguntas[0].enunciado, '¿Dónde se produce el ATP?');
  assert.equal(rehecho.preguntas[0].puntos, primera.puntos);

  // Editar a mano: lo que deja la pregunta sin sus datos se rechaza
  await assert.rejects(flujo.editarPreguntaExamen(asig.id, ex.id, primera.id, { opciones: ['Solo una'] } as Partial<PreguntaExamen>), /Faltan datos/);

  // Papelera
  await flujo.eliminarExamen(asig.id, ex.id);
  assert.equal((await flujo.listarExamenes(asig.id)).length, 0);
  const [enPapelera] = await listarPapelera(almacen);
  assert.equal(enPapelera.tipo, 'examen');
  assert.equal(enPapelera.titulo, 'Examen del tema 1');
  await restaurarDePapelera(almacen, enPapelera.id);
  assert.deepEqual((await flujo.listarExamenes(asig.id)).map((e) => e.titulo), ['Examen del tema 1']);
});

test('tipos de pregunta nuevos: validación, enunciado, clave y Moodle', async () => {
  const { preguntaValida, respuestaPregunta, partesPregunta, bloqueAMarkdown } = await import('../shared/actividades');
  const { generarGift } = await import('../server/moodle');
  const preguntas: PreguntaExamen[] = [
    { id: 'm', tipo: 'multiple', puntos: 1, enunciado: '¿Cuáles son gases nobles?', opciones: ['Helio', 'Sodio', 'Neón', 'Cloro'], correctas: [2, 0] },
    { id: 'j', tipo: 'vfjustificada', puntos: 1, enunciado: 'El sodio es un gas noble.', correcta: false, explicacion: 'Es un metal alcalino.' },
    { id: 'o', tipo: 'ordenar', puntos: 1, enunciado: 'Ordena de menor a mayor número atómico.', elementos: ['H', 'He', 'Li', 'Be'] },
    { id: 'c', tipo: 'clasificar', puntos: 1, enunciado: 'Clasifica.', categorias: [{ nombre: 'Metales', elementos: ['Na', 'K'] }, { nombre: 'No metales', elementos: ['O', 'S'] }] },
    { id: 'e', tipo: 'error', puntos: 1, enunciado: 'El agua hierve a 50 °C a nivel del mar.', respuestas: ['El agua hierve a 100 °C a nivel del mar.'], explicacion: 'La temperatura es incorrecta.' },
    { id: 'd', tipo: 'definicion', puntos: 1, enunciado: 'Define «isótopo».', explicacion: 'Átomos del mismo elemento con distinto número de neutrones.' },
    { id: 't', tipo: 'datos', puntos: 2, material: '| Año | Casos |\n|---|---|\n| 2020 | 10 |\n| 2021 | 20 |', enunciado: 'a) Describe la tendencia.', solucion: 'Se duplica.' },
    { id: 'x', tipo: 'comentario', puntos: 2, material: 'Texto que se comenta.', enunciado: 'a) Resume el texto.', solucion: 'Resumen.' },
  ];
  assert.ok(preguntas.every((p) => preguntaValida(p)));
  assert.equal(preguntaValida({ tipo: 'multiple', enunciado: 'x', opciones: ['a', 'b', 'c'], correctas: [5] }), false);
  assert.equal(preguntaValida({ tipo: 'ordenar', enunciado: 'x', elementos: ['a', 'b'] }), false);
  assert.equal(preguntaValida({ tipo: 'comentario', enunciado: 'x' }), false);

  assert.equal(respuestaPregunta(preguntas[0], 'multiple', 'm'), 'a) Helio; c) Neón');
  // Ordenar: los elementos salen desordenados y la clave da su orden con las letras que se muestran
  const { resto } = partesPregunta(preguntas[2], 'ordenar', 'o');
  const mostrados = resto.filter((l) => l.startsWith('- ')).map((l) => l.replace(/^- \*\*[a-z]\)\*\* /, ''));
  assert.deepEqual([...mostrados].sort(), ['Be', 'H', 'He', 'Li']);
  const clave = respuestaPregunta(preguntas[2], 'ordenar', 'o').split(' → ');
  assert.deepEqual(clave.map((l) => mostrados['abcd'.indexOf(l)]), ['H', 'He', 'Li', 'Be']);
  assert.match(respuestaPregunta(preguntas[3], 'clasificar', 'c'), /^Metales: \d, \d · No metales: \d, \d$/);

  const ex = { id: 'z', titulo: 'Química', opciones: { documentos: [], fuentesAsignatura: [], tipos: {}, dificultad: 'media', total: 10 }, estado: 'listo', preguntas, creado: '', actualizado: '' } as const;
  const enunciado = examenAMarkdown(ex as any);
  assert.match(enunciado, /puede haber varias correctas/);
  assert.match(enunciado, /Justifica tu respuesta/);
  assert.match(enunciado, /> Texto que se comenta\./);
  assert.match(enunciado, /\| 2021 \| 20 \|/);
  assert.doesNotMatch(enunciado, /metal alcalino|Átomos del mismo elemento/);
  const rubrica = rubricaAMarkdown(ex as any);
  assert.match(rubrica, /Falso\. Es un metal alcalino/);
  assert.match(rubrica, /Átomos del mismo elemento/);
  assert.match(rubrica, /Pregunta 7 \(2 puntos\)/); // datos y comentario van con rúbrica

  const gift = generarGift([{ id: 'b', titulo: 'B', opciones: { tipos: {}, dificultad: 'media', secciones: [], soluciones: true }, estado: 'lista', incluir: true, preguntas, creado: '', actualizado: '' }], 'Química');
  assert.match(gift, /~%50%Helio/);
  assert.match(gift, /~%-50%Sodio/);
  assert.match(gift, /=H -> 1\.º/);
  assert.match(gift, /=Na -> Metales/);

  // Actividades con los mismos tipos
  const md = bloqueAMarkdown({ id: 'b', titulo: 'Repaso', opciones: { tipos: {}, dificultad: 'media', secciones: [], soluciones: true }, estado: 'lista', incluir: true, preguntas, creado: '', actualizado: '' });
  assert.match(md, /\*\*Metales:\*\* \\_\\_/);
  assert.match(md, /    \| 2021 \| 20 \|/); // la tabla, dentro del elemento de la lista
  assert.match(md, /::: solucion[\s\S]*a\) Helio; c\) Neón/);
});

test('en papel: optatividad, modelo B, espacio para responder y hoja de respuestas', async () => {
  const { totalExamen, repartirPuntos, modeloB, partesExamen } = await import('../shared/examenes');
  const base = (preguntas: PreguntaExamen[], extra = {}) =>
    ({ id: 'ex', titulo: 'Examen', estado: 'listo', creado: '', actualizado: '', preguntas, opciones: { documentos: [], fuentesAsignatura: [], tipos: {}, dificultad: 'media', total: 10, ...extra } }) as any;
  const test = (id: string, correcta: number): PreguntaExamen => ({ id, tipo: 'test', puntos: 1, enunciado: `Pregunta ${id}`, opciones: ['uno', 'dos', 'tres', 'cuatro'], correcta });
  const des = (id: string): PreguntaExamen => ({ id, tipo: 'desarrollo', puntos: 2, enunciado: `Explica ${id}` });

  // Tres de desarrollo de las que se responden dos: el examen vale lo de dos
  const ex = base([test('t1', 0), test('t2', 1), test('t3', 2), test('t4', 3), des('d1'), des('d2'), des('d3')], { elegir: { desarrollo: 2 }, espacio: true });
  assert.equal(totalExamen(ex), 4 + 4);
  const repartidas = repartirPuntos(ex);
  assert.equal(totalExamen({ ...ex, preguntas: repartidas }), 10);
  const desarrollo = repartidas.filter((p) => p.tipo === 'desarrollo').map((p) => p.puntos);
  assert.ok(desarrollo.every((x) => x === desarrollo[0])); // en la parte optativa, todas valen lo mismo
  assert.equal(partesExamen(ex)[1].elegir, 2);
  const md = examenAMarkdown({ ...ex, preguntas: repartidas });
  assert.match(md, /responde a 2 de 3/);
  assert.match(md, /Responde solo a 2 de estas 3 preguntas/);
  assert.match(md, /\| Máximo \|/); // tabla de calificación
  assert.match(md, /Espacio para responder: 15 líneas/);

  // Espacio para responder en cada formato y hoja de respuestas
  const conHoja = { ...ex, preguntas: repartidas, opciones: { ...ex.opciones, hojaRespuestas: true } };
  assert.match(examenAMarkdown(conHoja, { formato: 'pdf', salto: '```{=typst}\n#pagebreak()\n```' }), /```\{=typst\}\n#block\(width: 100%\)\[#for _ in range\(15\)/);
  assert.match(examenAMarkdown(conHoja, { formato: 'docx' }), /w:between/);
  for (const format of ['vista', 'pdf', 'docx', 'odt'] as const) {
    const enabled = examenAMarkdown(conHoja, { formato: format });
    for (const space of [false, undefined]) {
      const disabled = examenAMarkdown({ ...conHoja, opciones: { ...conHoja.opciones, espacio: space } }, { formato: format });
      assert.ok(disabled.length < enabled.length, `Answer space must be opt-in for ${format}`);
      assert.doesNotMatch(disabled, /Espacio para responder|#for _ in range|w:pBdr/);
    }
  }
  const hoja = examenAMarkdown(conHoja);
  assert.match(hoja, /## Hoja de respuestas/);
  assert.match(hoja, /\| Pregunta \| a \| b \| c \| d \|/);
  assert.doesNotMatch(examenAMarkdown({ ...conHoja, opciones: { ...conHoja.opciones, espacio: false, tablaNotas: false } }), /Espacio para responder|\| Máximo \|/);

  // Modelo B: las mismas preguntas en otro orden y la respuesta correcta sigue siendo la misma opción
  const b = modeloB(ex);
  assert.deepEqual(new Set(b.preguntas.map((p) => p.enunciado)), new Set(ex.preguntas.map((p: PreguntaExamen) => p.enunciado)));
  for (const q of b.preguntas.filter((p) => p.tipo === 'test')) {
    const original = ex.preguntas.find((p: PreguntaExamen) => p.enunciado === q.enunciado)!;
    assert.equal(q.opciones![q.correcta as number], original.opciones[original.correcta]);
  }
  assert.notDeepEqual(
    b.preguntas.map((p) => p.opciones?.join()),
    ex.preguntas.map((p: PreguntaExamen) => p.opciones?.join()),
  );
});

test('respuesta numérica, texto con huecos, completar tabla, esquema y redacción', async () => {
  const { preguntaValida, respuestaPregunta, partesPregunta } = await import('../shared/actividades');
  const { generarGift } = await import('../server/moodle');
  const num: PreguntaExamen = { id: 'n', tipo: 'numerica', puntos: 1, enunciado: 'Calcula la molaridad.', valor: 2.5, tolerancia: 0.05, unidades: 'mol/L' };
  const banco: PreguntaExamen = { id: 'b', tipo: 'banco', puntos: 1, enunciado: 'El ___ produce ATP y el ___ hace la fotosíntesis.', respuestas: ['mitocondria', 'cloroplasto'], opciones: ['núcleo'] };
  const tabla: PreguntaExamen = { id: 't', tipo: 'tabla', puntos: 1, enunciado: 'Completa la tabla.', material: '| Partícula | Carga |\n|---|---|\n| Protón | ___ |\n| ___ | −1 |', respuestas: ['+1', 'Electrón'] };
  const esquema: PreguntaExamen = { id: 'e', tipo: 'esquema', puntos: 2, enunciado: 'Dibuja una célula eucariota animal.', explicacion: 'Membrana, citoplasma, núcleo y mitocondrias rotulados.' };
  const redaccion: PreguntaExamen = { id: 'r', tipo: 'redaccion', puntos: 2, enunciado: 'Escribe una carta de 150-200 palabras.' };
  for (const p of [num, banco, tabla, esquema, redaccion]) assert.ok(preguntaValida(p), p.tipo);
  assert.equal(preguntaValida({ ...banco, respuestas: ['solo una'] }), false); // tantas respuestas como huecos
  assert.equal(preguntaValida({ ...num, valor: undefined }), false);

  assert.equal(respuestaPregunta(num, 'numerica', 'n'), '2,5 mol/L (± 0,05)');
  assert.equal(respuestaPregunta(tabla, 'tabla', 't'), '(1) +1; (2) Electrón');
  const { enunciado, resto } = partesPregunta(banco, 'banco', 'b');
  assert.match(enunciado, /sobran algunas/);
  assert.match(resto.join('\n'), /El \*\*\(1\)\*\* .* el \*\*\(2\)\*\* /);
  assert.match(resto[0], /mitocondria/);
  assert.match(partesPregunta(tabla, 'tabla', 't').resto[0], /\| Protón \| \*\*\(1\)\*\*/);

  const ex = { id: 'z', titulo: 'X', estado: 'listo', creado: '', actualizado: '', preguntas: [num, banco, tabla, esquema, redaccion], opciones: { documentos: [], fuentesAsignatura: [], tipos: {}, dificultad: 'media', total: 7 } } as any;
  const md = examenAMarkdown({ ...ex, opciones: { ...ex.opciones, espacio: true } });
  assert.match(md, /\*\*Resultado:\*\* .* mol\/L/);
  assert.match(md, /un recuadro de 14 líneas/); // esquema
  assert.match(md, /Espacio para responder: 20 líneas/); // redacción
  assert.match(rubricaAMarkdown(ex), /Pregunta 5 \(2 puntos\)/); // redacción, con rúbrica

  const gift = generarGift([{ id: 'g', titulo: 'G', opciones: { tipos: {}, dificultad: 'media', secciones: [], soluciones: true }, estado: 'lista', incluir: true, preguntas: [num, banco], creado: '', actualizado: '' }], 'X');
  assert.match(gift, /\{#2\.5:0\.05/);
  assert.match(gift, /=Hueco 1 -> mitocondria/);
});
