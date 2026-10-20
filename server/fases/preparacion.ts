// Fases 1 y 2: investigación (y sus preguntas) e índice director.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EntradaIndice, Indice, PreguntaInvestigacion, Trabajo } from '../../shared/tipos';
import { ErrorUsuario } from '../store';
import { INDICE_VACIO, profundidadValida, limpiarApartados, respuestaEnDossier } from './utilidades';
import { FlujoBase } from './base';

export class FlujoPreparacion extends FlujoBase {

  // ---------------------------------------------------------------------------
  // 1. Investigación

  async investigar(asig: string, doc: string, indicaciones?: string, soloPreguntas = false) {
    if (this.ocupado('investigacion', asig, doc)) throw new ErrorUsuario('Ya hay una investigación en curso');
    await this.prepararFuentes(asig, doc);
    const existe = existsSync(path.join(this.almacen.dirDocumento(asig, doc), 'investigacion.md'));
    const pendientes = (await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', [])).filter(
      (p) => p.estado !== 'respondida',
    );
    if (soloPreguntas && !pendientes.length) throw new ErrorUsuario('No hay preguntas pendientes');
    const bloquePreguntas = pendientes.length
      ? `

### Preguntas del usuario
Responde también a estas preguntas. Para cada una, añade en \`investigacion.md\`, dentro de la sección \`## Preguntas investigadas\` (créala antes de \`## Fuentes\` si no existe), un apartado con este encabezado exacto y la respuesta debajo, citando las fuentes con [n]:
${pendientes.map((p) => `- \`### Pregunta: ${p.texto}\``).join('\n')}`
      : '';
    await this.marcarPreguntas(asig, doc, pendientes.map((p) => p.id), 'investigando');
    const tarea = soloPreguntas
      ? `Investiga las preguntas pendientes del usuario y añade las respuestas al dossier \`investigacion.md\`, sin rehacer el resto del dossier.
Consulta el material aportado (\`fuentes/\`, \`../../fuentes/\`) y fuentes fiables de la web. Añade las fuentes nuevas a la lista \`## Fuentes\` con su número [n]. No inventes datos ni referencias.${bloquePreguntas}`
      : null;
    return this.lanzar({
      agente: 'investigador',
      asignatura: asig,
      documento: doc,
      titulo: soloPreguntas ? `Investigar ${pendientes.length === 1 ? '1 pregunta' : `${pendientes.length} preguntas`}` : existe ? 'Ampliar la investigación' : 'Investigar el tema',
      paso: 'investigacion',
      indicaciones,
      post: { tipo: 'investigacion', datos: { preguntas: pendientes.map((p) => p.id) } },
      tarea: tarea ?? `Elabora el dossier de investigación del documento y guárdalo en \`investigacion.md\`${existe ? ' (ya existe: amplíalo y mejóralo, conservando lo valioso)' : ''}.

1. Revisa el material aportado en \`fuentes/\` y \`../../fuentes/\` si lo hay. Si tienes la herramienta \`buscar_en_fuentes\`, úsala (empieza con \`listar_fuentes\`) en lugar de leer los documentos enteros; si no, lee los archivos (para .docx, .odt y .pptx usa su versión de texto en \`.texto/\`). Las imágenes míralas directamente.
2. Busca en la web solo lo necesario para cubrir el objetivo con rigor, con un máximo orientativo de 12 fuentes fiables. No rellenes una cuota ni cuentes copias del mismo origen como confirmaciones independientes. Reutiliza lo ya consultado.
3. Estructura del dossier (en Markdown):
   - \`# Dossier: <título del documento>\`
   - \`## Enfoque\`: qué deben aprender los destinatarios, cómo enfocarlo y límites de la búsqueda (material consultado y aspectos sin verificar).
   - \`## Conceptos clave\`: definiciones precisas.
   - \`## Contenidos\`: organizados por bloques temáticos, con ideas, datos y ejemplos, citando la fuente con [n].
   - \`## Dificultades y errores frecuentes\` del alumnado.
   - \`## Ejemplos, aplicaciones y curiosidades\`.
   - \`## Ideas para apoyos visuales\`.
   - \`## Fuentes\`: lista numerada [n] con autor u organización, título, URL o nombre del archivo y fecha de consulta.
Marca con «(material aportado)» las ideas que procedan del material del profesor. No inventes datos ni referencias.${bloquePreguntas}`,
    });
  }

  // Preguntas de investigación (las escribe el usuario; el servidor es el único que guarda el archivo)

  async anadirPregunta(asig: string, doc: string, texto: string) {
    const limpio = texto.trim().replace(/\s+/g, ' ');
    if (!limpio) throw new ErrorUsuario('Escribe la pregunta');
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      if (lista.some((p) => p.texto.toLowerCase() === limpio.toLowerCase())) throw new ErrorUsuario('Esa pregunta ya está en la lista');
      const p: PreguntaInvestigacion = { id: randomUUID().slice(0, 8), texto: limpio, estado: 'pendiente', creado: new Date().toISOString() };
      lista.push(p);
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista);
      return p;
    });
  }

  async eliminarPregunta(asig: string, doc: string, id: string) {
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista.filter((p) => p.id !== id));
    });
  }

  protected async marcarPreguntas(asig: string, doc: string, ids: string[], estado: PreguntaInvestigacion['estado'] | 'segun-dossier') {
    if (!ids.length) return;
    return this.conCandado(`${asig}/${doc}/preguntas`, async () => {
      const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
      const dossier = estado === 'segun-dossier' ? await this.almacen.leerArchivoDoc(asig, doc, 'investigacion.md') : '';
      for (const p of lista) {
        if (!ids.includes(p.id)) continue;
        p.estado = estado === 'segun-dossier' ? (respuestaEnDossier(dossier, p.texto) ? 'respondida' : 'pendiente') : estado;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'preguntas.json', lista);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Índice

  async proponerIndice(asig: string, doc: string, indicaciones?: string, profundidadPedida?: number, soloApartados = false) {
    if (this.ocupado('indice', asig, doc)) throw new ErrorUsuario('Ya se está proponiendo un índice');
    await this.prepararFuentes(asig, doc);
    const salida = this.salida('indice');
    const actual = await this.almacen.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null);
    const profundidad = profundidadValida(profundidadPedida ?? actual?.profundidad);
    // El índice actual va en el mensaje (sin campos internos) para que no tenga que leerlo
    const indiceActual = actual?.entradas.length
      ? `

## Índice actual (indice.json; ya incluido, no hace falta leerlo)
${JSON.stringify(
          actual.entradas.map(({ titulo, objetivo, contenidos, extension, visuales, apartados }) => ({ titulo, objetivo, contenidos, extension, visuales, apartados })),
          (k, v) => (k === 'id' ? undefined : v),
        )}`
      : '';
    if (soloApartados && !actual?.entradas.length) throw new ErrorUsuario('Primero hace falta un índice con secciones');
    const guia = await this.guiaImportacion(asig, doc);
    // Con el currículo oficial, el índice se planifica para cubrir los criterios que tocan a este tema
    const curriculo = await this.curriculumReference(asig, doc);
    const conCurriculo = curriculo.trim()
      ? `

## Currículo estructurado activo de la asignatura
Planifica el índice para que cubra los resultados de aprendizaje, criterios de evaluación o saberes básicos que correspondan a ESTE documento (según su título y su objetivo; no todo el currículo). En el «objetivo» de cada sección indica entre paréntesis los códigos que trabaja (p. ej. «(RA2: a, b)» o «(CE 3.1, 3.2)»).

${curriculo}`
      : '';
    const ejemploApartados =
      profundidad === 1
        ? ''
        : profundidad === 2
          ? `,
      "apartados": [ { "titulo": "Apartado 1" }, { "titulo": "Apartado 2" } ]`
          : `,
      "apartados": [
        { "titulo": "Apartado 1", "apartados": [ { "titulo": "Subapartado 1.1" }, { "titulo": "Subapartado 1.2" } ] },
        { "titulo": "Apartado 2", "apartados": [] }
      ]`;
    const reglaProfundidad =
      profundidad === 1
        ? 'Profundidad: solo secciones (no incluyas apartados).'
        : profundidad === 2
          ? 'Profundidad: secciones con sus apartados (2-6 por sección). Sin subapartados.'
          : 'Profundidad: secciones, apartados (2-6 por sección) y subapartados donde aporten claridad (no hace falta que todos los apartados los tengan).';
    return this.lanzar({
      agente: 'arquitecto',
      asignatura: asig,
      documento: doc,
      titulo: soloApartados ? 'Desarrollar los apartados del índice' : actual ? 'Rehacer el índice' : 'Proponer el índice',
      paso: 'indice',
      incluir: { dossier: true },
      indicaciones,
      tarea: (soloApartados
        ? `Desarrolla los apartados del índice director (\`indice.json\`) hasta la profundidad pedida. Mantén EXACTAMENTE las mismas secciones, con sus títulos, su orden y el resto de sus campos; solo añade o mejora sus apartados. Usa el dossier (\`investigacion.md\`) y el material aportado si existen.
${reglaProfundidad}

NO crees ni modifiques secciones. Escribe el índice completo en el archivo \`${salida}\` con este JSON exacto (sin comentarios):

{
  "notas": "breve justificación",
  "entradas": [
    {
      "titulo": "Título de la sección (igual que ahora)",
      "objetivo": "…",
      "contenidos": ["…"],
      "extension": "…",
      "visuales": "…"${ejemploApartados}
    }
  ]
}

Si el usuario te pide cambios después, vuelve a escribir el archivo completo.${indiceActual}${conCurriculo}`
        : `Diseña el índice director del documento a partir del dossier (\`investigacion.md\`, si existe), del material aportado y del objetivo.
${actual ? 'Ya existe un índice en `indice.json`: tenlo en cuenta y mejóralo según las indicaciones.\n' : ''}
NO crees ni modifiques secciones. Escribe tu propuesta en el archivo \`${salida}\` con este JSON exacto (sin comentarios):

{
  "notas": "breve justificación del enfoque y de la secuencia",
  "entradas": [
    {
      "titulo": "Título de la sección",
      "objetivo": "Qué debe entender o saber hacer quien la estudie",
      "contenidos": ["punto 1", "punto 2", "..."],
      "extension": "p. ej. 500-700 palabras",
      "visuales": "apoyos visuales recomendados o cadena vacía"${ejemploApartados}
    }
  ]
}

${reglaProfundidad}
Entre 3 y 12 secciones, según la extensión pedida. La primera puede ser una introducción breve y la última un resumen o síntesis; no incluyas una sección de autoevaluación (hay un agente para eso).
Si el usuario te pide cambios después, vuelve a escribir el archivo completo con la versión corregida.${indiceActual}${conCurriculo}`) + guia,
      post: { tipo: 'indice', datos: { salida, profundidad } },
    });
  }

  async guardarIndice(asig: string, doc: string, indice: Indice) {
    if (!Array.isArray(indice?.entradas)) throw new ErrorUsuario('Índice no válido');
    const profundidad = profundidadValida(indice.profundidad);
    const limpio: Indice = {
      profundidad,
      notas: String(indice.notas ?? ''),
      aprobado: !!indice.aprobado,
      actualizado: new Date().toISOString(),
      entradas: indice.entradas
        .filter((e) => e.titulo?.trim())
        .map((e) => ({
          id: e.id || randomUUID().slice(0, 8),
          titulo: e.titulo.trim(),
          objetivo: String(e.objetivo ?? ''),
          contenidos: (e.contenidos ?? []).map(String).filter((c) => c.trim()),
          apartados: limpiarApartados(e.apartados, profundidad - 1),
          extension: String(e.extension ?? ''),
          visuales: String(e.visuales ?? ''),
          archivo: e.archivo,
        })),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', limpio);
    return limpio;
  }

  /** Aprueba el índice: crea las secciones que falten y ordena los archivos según el índice. */
  async aprobarIndice(asig: string, doc: string) {
    return this.conCandado(`${asig}/${doc}/secciones`, async () => {
      const indice = await this.almacen.leerJsonDoc<Indice>(asig, doc, 'indice.json', INDICE_VACIO);
      if (!indice.entradas.length) throw new ErrorUsuario('El índice está vacío');
      let existentes = await this.almacen.listarSecciones(asig, doc);
      const nombres = new Set(existentes.map((s) => s.archivo));
      for (const e of indice.entradas) {
        if (e.archivo && nombres.has(e.archivo)) continue;
        const s = await this.almacen.crearSeccion(asig, doc, e.titulo);
        e.archivo = s.archivo;
        nombres.add(s.archivo);
      }
      // Orden: las del índice primero; las demás (p. ej. autoevaluación) detrás
      existentes = await this.almacen.listarSecciones(asig, doc);
      const delIndice = indice.entradas.map((e) => e.archivo!);
      const resto = existentes.map((s) => s.archivo).filter((a) => !delIndice.includes(a));
      const nuevas = await this.almacen.renumerar(asig, doc, [...delIndice, ...resto]);
      const base = (a: string) => a.replace(/^\d+-/, '');
      for (const e of indice.entradas) e.archivo = nuevas.find((s) => base(s.archivo) === base(e.archivo!))?.archivo;
      indice.aprobado = true;
      indice.actualizado = new Date().toISOString();
      await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', indice);
      return indice;
    });
  }

  protected async postInvestigacion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const info = await this.almacen.infoArchivoDoc(asig, doc, 'investigacion.md');
    if (!info) throw new Error('El agente no ha creado investigacion.md. Respóndele para que lo haga.');
    const ids = (datos.preguntas as string[] | undefined) ?? [];
    if (!ids.length) return 'Dossier de investigación listo';
    await this.marcarPreguntas(asig, doc, ids, 'segun-dossier');
    const lista = await this.almacen.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []);
    const sin = lista.filter((p) => ids.includes(p.id) && p.estado !== 'respondida').length;
    return sin
      ? `Dossier actualizado, pero ${sin === 1 ? 'una pregunta quedó' : `${sin} preguntas quedaron`} sin responder. Respóndele para que las complete.`
      : `Dossier actualizado: ${ids.length === 1 ? 'pregunta respondida' : `${ids.length} preguntas respondidas`}`;

  }

  protected async postIndice(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const actual = await this.almacen.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null);
    const r = await this.leerSalida<{ notas?: string; entradas?: Partial<EntradaIndice>[] }>(asig, doc, salida);
    const entradas = (r.entradas ?? []).filter((e) => e?.titulo?.trim());
    if (!entradas.length) throw new Error('El índice propuesto está vacío. Respóndele para que lo complete.');
    const previas = actual?.entradas ?? [];
    const profundidad = profundidadValida(datos.profundidad);
    const indice: Indice = {
      profundidad,
      notas: String(r.notas ?? ''),
      aprobado: false,
      actualizado: new Date().toISOString(),
      entradas: entradas.map((e) => {
        // Conservar la sección ya creada si el título coincide
        const previa = previas.find((p) => p.titulo.trim().toLowerCase() === e.titulo!.trim().toLowerCase());
        return {
          id: randomUUID().slice(0, 8),
          titulo: e.titulo!.trim(),
          objetivo: String(e.objetivo ?? ''),
          contenidos: Array.isArray(e.contenidos) ? e.contenidos.map(String) : [],
          apartados: limpiarApartados(e.apartados, profundidad - 1),
          extension: String(e.extension ?? ''),
          visuales: String(e.visuales ?? ''),
          archivo: previa?.archivo,
        };
      }),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', indice);
    return `Índice propuesto: ${indice.entradas.length} secciones. Revísalo y apruébalo.`;

  }
}
