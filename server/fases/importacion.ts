// Mejorar unos apuntes existentes: importarlos, transcribir un PDF y el diagnóstico.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EntradaIndice,
  Indice,
  Profundidad,
  Trabajo,
  AccionDiagnostico,
  AreaDiagnostico,
  Diagnostico,
  Importacion,
  ModoMejora,
  ProblemaDiagnostico,
} from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../shared/tipos';
import { ErrorUsuario, slug } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { contarPalabras } from '../texto';
import { aMarkdown, formatoDe, leerPdf, limpiar, partirEnSecciones, type SeccionImportada, type ImportedPdf } from '../importar';
import { missingPdfImages, type ImportedPdfImage } from '../pdfImages';
import { claveSeccion } from '../historial';
import { FlujoActividades } from './actividades';
import { separateImportedContent } from '../importContent';
import { bloqueAMarkdown } from '../../shared/actividades';

export class FlujoImportacion extends FlujoActividades {

  // ---------------------------------------------------------------------------
  // Unos apuntes existentes: importarlos y diagnosticarlos

  /**
   * Crea un documento a partir de unos apuntes (Word, LibreOffice, Markdown o PDF). En modo
   * conservador se convierten en las secciones del documento (y su índice); en los otros, son la
   * fuente principal de un índice nuevo, que se pide enseguida al arquitecto.
   */
  async importar(
    asig: string,
    archivo: { ruta: string; nombre: string },
    op: { titulo?: string; objetivo?: string; destinatarios?: string; modo?: ModoMejora; estiloOriginal?: boolean; diagnosticar?: boolean; importOnly?: boolean },
  ) {
    const formato = formatoDe(archivo.nombre);
    if (!formato) throw new ErrorUsuario('Formato no admitido: usa Word (.docx), LibreOffice (.odt), Markdown (.md, o .zip con sus imágenes) o PDF');
    const modo: ModoMejora = !op.importOnly && (op.modo === 'reestructurar' || op.modo === 'reescribir') ? op.modo : 'conservador';
    const nombre = archivo.nombre.replace(/[\\/:*?"<>|]/g, '_');
    const sinExtension = path.basename(nombre, path.extname(nombre)).replace(/[-_]+/g, ' ').trim();
    // Primero se lee y se convierte (en una carpeta temporal): si falla, no se crea el documento
    const tmpRecursos = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-recursos-'));
    try {
      const pdf = formato === 'pdf' ? await leerPdf(archivo.ruta, tmpRecursos) : undefined;
      const convertido = formato === 'pdf' ? undefined : await aMarkdown(archivo.ruta, nombre, this.dep.dirBin, tmpRecursos);
      if (convertido && contarPalabras(convertido.texto) < 30) throw new ErrorUsuario('El archivo apenas tiene texto: no hay apuntes que importar');
      const content = convertido && modo === 'conservador' ? separateImportedContent(convertido.texto) : undefined;
      const partido = content ? content.notes.trim() ? partirEnSecciones(content.notes, sinExtension || 'Apuntes') : { secciones: [] } : undefined;
      const estiloOriginal = (formato === 'docx' || formato === 'odt') && !!op.estiloOriginal;
      const documento = await this.almacen.crearDocumento(asig, {
        titulo: op.titulo?.trim() || convertido?.titulo || partido?.titulo || sinExtension || 'Apuntes importados',
        objetivo: op.objetivo ?? '',
        destinatarios: op.destinatarios ?? '',
        importado: {
          archivo: nombre,
          formato,
          modo,
          fecha: new Date().toISOString(),
          ...(estiloOriginal ? { estiloOriginal, estiloCuerpo: convertido?.estiloCuerpo, estiloTabla: convertido?.estiloTabla } : {}),
        },
      });
      const doc = documento.id;
      try {
        const dir = this.almacen.dirDocumento(asig, doc);
        await fs.mkdir(path.join(dir, 'original'), { recursive: true });
        await fs.copyFile(archivo.ruta, path.join(dir, 'original', nombre));
        if (estiloOriginal) await fs.copyFile(archivo.ruta, path.join(dir, `plantilla.${formato}`));
        if (convertido) await fs.writeFile(path.join(dir, 'original', 'contenido.md'), convertido.texto, 'utf8');
        await fs.cp(tmpRecursos, path.join(dir, 'recursos'), { recursive: true, force: true });
        const avisos = [...(convertido?.avisos ?? []), ...(pdf?.warnings ?? [])];
        let secciones = 0;
        let trabajos = 0;
        if (pdf) {
          await this.almacen.escribirJsonDoc(asig, doc, 'pdf-images.json', pdf.images);
          // El PDF va a las fuentes del documento: los agentes lo consultan y se indexa para buscar en él
          await fs.copyFile(archivo.ruta, path.join(this.almacen.dirFuentes(asig, doc), nombre));
          if (modo === 'conservador') {
            await this.transcribirPdf(asig, doc, nombre, pdf, !!op.diagnosticar);
            trabajos++;
            avisos.push(pdf.images.length ? `Se han extraído ${new Set(pdf.images.map(image => image.file)).size} imágenes del PDF. El transcriptor las situará en los apuntes.` : 'No se han encontrado imágenes rasterizadas en el PDF. Las figuras dibujadas con vectores requieren revisión.');
          }
        } else if (partido) {
          secciones = await this.crearSeccionesImportadas(asig, doc, partido.secciones, nombre);
          await this.almacen.escribirJsonDoc(asig, doc, 'actividades.json', content!.activities);
          if (content!.activities.length) avisos.push(`Se han separado ${content!.activities.length} bloques de ejercicios en Autoevaluación. Revisa sus enunciados y soluciones antes de exportarlos.`);
        } else if (convertido) {
          await fs.writeFile(path.join(this.almacen.dirFuentes(asig, doc), 'apuntes-originales.md'), convertido.texto, 'utf8');
        }
        if (modo !== 'conservador') {
          await this.proponerIndice(asig, doc);
          trabajos++;
        } else if (op.diagnosticar && !pdf && secciones > 0) {
          await this.diagnosticar(asig, doc);
          trabajos++;
        }
        return { documento, secciones, actividades: content?.activities.length ?? 0, imagenes: convertido?.imagenes ?? (pdf ? new Set(pdf.images.map(image => image.file)).size : 0), trabajos, avisos };
      } catch (e) {
        // Un documento a medio importar no sirve: se quita (a la papelera)
        await this.almacen.eliminarDocumento(asig, doc).catch(() => {});
        throw e;
      }
    } finally {
      await fs.rm(tmpRecursos, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Escribe las secciones importadas, su copia original (para comparar) y el índice ya aprobado. */
  protected async crearSeccionesImportadas(asig: string, doc: string, lista: SeccionImportada[], origen: string) {
    return this.conCandado(`${asig}/${doc}/secciones`, async () => {
      const dir = this.almacen.dirDocumento(asig, doc);
      const usados = new Set<string>();
      const entradas: EntradaIndice[] = [];
      let profundidad: Profundidad = 1;
      for (const [i, s] of lista.entries()) {
        let base = slug(s.titulo);
        for (let n = 2; usados.has(base); n++) base = `${slug(s.titulo)}-${n}`;
        usados.add(base);
        const archivo = `${String(i + 1).padStart(2, '0')}-${base}.md`;
        await this.almacen.guardarSeccion(asig, doc, archivo, s.texto);
        const original = path.join(dir, 'original', 'secciones', `${claveSeccion(archivo)}.md`);
        await fs.mkdir(path.dirname(original), { recursive: true });
        await fs.writeFile(original, s.texto, 'utf8');
        if (s.apartados.length) profundidad = Math.max(profundidad, s.apartados.some((a) => a.apartados.length) ? 3 : 2) as Profundidad;
        entradas.push({ id: randomUUID().slice(0, 8), titulo: s.titulo, objetivo: '', contenidos: [], apartados: s.apartados, extension: '', visuales: '', archivo });
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'indice.json', {
        profundidad,
        entradas,
        notas: `Estructura de los apuntes importados de «${origen}».`,
        aprobado: true,
        actualizado: new Date().toISOString(),
      } satisfies Indice);
      return lista.length;
    });
  }

  /** Un agente transcribe el PDF a Markdown con su estructura; al terminar se reparte en secciones. */
  protected async transcribirPdf(asig: string, doc: string, nombre: string, pdf: ImportedPdf, diagnosticar: boolean) {
    const salida = this.salida('transcripcion', 'md');
    const textoPlano = this.salida('pdf-texto', 'md');
    await fs.mkdir(path.join(this.almacen.dirDocumento(asig, doc), '.agentes'), { recursive: true });
    await fs.writeFile(path.join(this.almacen.dirDocumento(asig, doc), textoPlano), pdf.texto, 'utf8');
    return this.lanzar({
      agente: 'transcriptor',
      asignatura: asig,
      documento: doc,
      titulo: `Transcribir «${nombre}»`,
      paso: 'importacion',
      fuentes: false,
      tarea: `Transcribe a Markdown los apuntes del PDF \`fuentes/${nombre}\` (${pdf.paginas} páginas). Léelo con la herramienta de lectura de archivos; si no puedes leer PDF, usa \`${textoPlano}\`, que tiene el texto de cada página sin formato (y úsalo también para comprobar que no se te escapa nada).

Escribe el resultado COMPLETO en \`${salida}\`:
- Un encabezado \`#\` por cada tema o bloque principal, y \`##\` y \`###\` para los apartados, según la jerarquía del PDF. Sin numeración manual en los títulos.
- Listas, negritas y cursivas como en el original; tablas en Markdown con barras (\`| a | b |\`); fórmulas en LaTeX (\`$…$\` y \`$$…$$\`).
- Quita la portada, el índice o sumario, las cabeceras y pies de página, los números de página y los guiones de corte de palabra.
- Las imágenes rasterizadas del PDF ya están extraídas localmente. Insértalas en el punto que corresponda con enlaces Markdown \`![pie o descripción](recursos/pdf-imagen-….png)\`. Usa EXACTAMENTE las rutas del inventario, no las cambies ni inventes archivos. Conserva los pies y sitúa las imágenes de los ejercicios dentro de sus enunciados.
${pdf.images.map(image => `  - Página ${image.page}: \`${image.file}\` (${image.width} × ${image.height} píxeles)`).join('\n') || '  - No se han encontrado imágenes rasterizadas.'}
- Si una figura vectorial no tiene imagen extraída, conserva una marca \`> [Figura: descripción breve]\` para revisarla; no sustituyas por esa marca una imagen que sí figura en el inventario.
- No resumas, no corrijas, no reordenes ni añadas nada: es el texto del autor.
Transcribe el documento entero aunque sea largo (si hace falta, escribe el archivo por partes, añadiendo al final). No toques ningún otro archivo.`,
      post: { tipo: 'transcripcion', datos: { salida, nombre, diagnosticar } },
    });
  }

  protected async postTranscripcion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const rel = String(datos.salida);
    const texto = await fs.readFile(path.join(this.almacen.dirDocumento(asig, doc), rel), 'utf8').catch(() => '');
    if (contarPalabras(texto) < 30) throw new PedirAlAgente('La transcripción está vacía o no se ha escrito', `No has escrito la transcripción en \`${rel}\` (o está casi vacía). Escríbela completa en ese archivo.`);
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const images = await this.almacen.leerJsonDoc<ImportedPdfImage[]>(asig, doc, 'pdf-images.json', []);
    const missing = missingPdfImages(texto, images);
    if (missing.length) throw new PedirAlAgente('La transcripción ha omitido imágenes del PDF', `Inserta en \`${rel}\` las imágenes extraídas que faltan, en los lugares correspondientes del texto o de sus ejercicios, usando estos enlaces Markdown exactos:\n${missing.map(image => `- Página ${image.page}: ![Figura](${image.file})`).join('\n')}\nNo cambies ni resumas el texto. No basta con una marca de figura sin enlace.`);
    const cleaned = limpiar(texto);
    const content = separateImportedContent(cleaned);
    await fs.writeFile(path.join(this.almacen.dirDocumento(asig, doc), 'original', 'contenido.md'), cleaned, 'utf8');
    const partido = content.notes.trim() ? partirEnSecciones(content.notes, documento.titulo) : { secciones: [] };
    const distributed = [...partido.secciones.map(section => section.texto), ...content.activities.map(block => bloqueAMarkdown(block))].join('\n\n');
    if (missingPdfImages(distributed, images).length) throw new PedirAlAgente('El reparto de la transcripción ha dejado imágenes fuera', `Organiza \`${rel}\` con encabezados claros y todas las imágenes dentro de una sección o un bloque de ejercicios. Conserva los enlaces extraídos y el contenido completo.`);
    const n = await this.crearSeccionesImportadas(asig, doc, partido.secciones, String(datos.nombre));
    await this.almacen.escribirJsonDoc(asig, doc, 'actividades.json', content.activities);
    if (datos.diagnosticar && n) await this.diagnosticar(asig, doc);
    return `PDF transcrito: ${n} secciones y ${content.activities.length} bloques de ejercicios${datos.diagnosticar && n ? '. Empieza el diagnóstico.' : ''}`;
  }

  /** El agente de diagnóstico lee todo el documento y escribe un informe (no toca el texto). */
  async diagnosticar(asig: string, doc: string, indicaciones?: string) {
    if (this.ocupado('diagnostico', asig, doc)) throw new ErrorUsuario('Ya se está haciendo un diagnóstico');
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo));
    if (!secciones.some((s) => s.palabras > 20)) throw new ErrorUsuario('El documento todavía no tiene texto que diagnosticar');
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const curriculo = await this.curriculumReference(asig, doc);
    const salida = this.salida('diagnostico');
    return this.lanzar({
      agente: 'diagnostico',
      asignatura: asig,
      documento: doc,
      titulo: 'Diagnóstico de los apuntes',
      paso: 'diagnostico',
      incluir: { secciones: secciones.map((s) => s.archivo) },
      indicaciones,
      tarea: `Haz un diagnóstico de estos apuntes${documento.importado ? ` (son unos apuntes existentes del profesor, importados de «${documento.importado.archivo}»)` : ''}. NO modifiques ningún archivo.
${secciones.map((s) => `- secciones/${s.archivo} (${s.titulo}, ${s.palabras} palabras)`).join('\n')}

Evalúa:
- contenido: errores, imprecisiones y lo que falta para el objetivo y los destinatarios;
- actualidad: datos, normativa o tecnologías desactualizados;
- estructura: secuencia, solapamientos, secciones demasiado largas o pobres;
- estilo: claridad, nivel y tono para los destinatarios;
${curriculo.trim() ? '- curriculo: criterios del currículo oficial (abajo) que corresponden a este tema y no se tratan;\n' : ''}- visuales: dónde ayudaría un esquema, una imagen, una tabla o una gráfica;
- actividades: si faltan ejercicios, ejemplos resueltos o autoevaluación;
- formato: tablas mal construidas, restos de la conversión, marcas de figuras sin imagen.

Escribe el resultado en \`${salida}\` con este JSON exacto:

{
  "resumen": "3-5 frases con la valoración general",
  "puntosFuertes": ["lo que hay que conservar", "..."],
  "problemas": [
    { "area": "contenido | actualidad | estructura | estilo | curriculo | visuales | actividades | formato", "seccion": "archivo de la sección, o cadena vacía si es general", "descripcion": "qué pasa y qué conviene hacer, concreto (cita el pasaje)", "gravedad": "baja | media | alta" }
  ],
  "recomendacion": "conservador | reestructurar | reescribir",
  "motivoRecomendacion": "por qué"
}

Recomendación: «conservador» si basta con corregir y completar sobre el texto actual; «reestructurar» si el contenido es bueno pero la organización no; «reescribir» si conviene rehacerlos usándolos como fuente. Como máximo 25 problemas, de más a menos importante; si no hay problemas comprobables, deja la lista vacía. No inventes defectos para alcanzar un mínimo. En «resumen» indica cualquier parte que no hayas podido comprobar, sin presentarla como revisada.${
        curriculo.trim() ? `\n\n===== Currículo estructurado activo de la asignatura =====\n${curriculo}\n===== fin del currículo =====` : ''
      }`,
      post: { tipo: 'diagnostico', datos: { salida } },
    });
  }

  protected async postDiagnostico(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const r = await this.leerSalida<Partial<Diagnostico> & { problemas?: Partial<ProblemaDiagnostico>[] }>(asig, doc, String(datos.salida));
    if (!r.resumen || !Array.isArray(r.problemas)) throw new PedirAlAgente('El diagnóstico no tiene el formato pedido', `El archivo ${datos.salida} no tiene el formato pedido (faltan «resumen» o «problemas»). Escríbelo de nuevo.`);
    const archivos = new Set((await this.almacen.listarSecciones(asig, doc)).map((s) => s.archivo));
    const areas: AreaDiagnostico[] = ['contenido', 'actualidad', 'estructura', 'estilo', 'curriculo', 'visuales', 'actividades', 'formato'];
    const acciones: Partial<Record<AreaDiagnostico, AccionDiagnostico>> = {
      contenido: 'calidad',
      actualidad: 'fuentes',
      estructura: 'indice',
      estilo: 'estilo',
      curriculo: 'curriculo',
      visuales: 'visuales',
      actividades: 'actividades',
      formato: 'calidad',
    };
    const problemas: ProblemaDiagnostico[] = r.problemas
      .filter((p) => p?.descripcion)
      .map((p) => {
        const area = areas.includes(p.area as AreaDiagnostico) ? (p.area as AreaDiagnostico) : 'contenido';
        const seccion = String(p.seccion ?? '').replace(/^secciones\//, '');
        return {
          id: randomUUID().slice(0, 8),
          area,
          ...(archivos.has(seccion) ? { seccion } : {}),
          descripcion: String(p.descripcion),
          gravedad: p.gravedad === 'alta' || p.gravedad === 'baja' ? p.gravedad : 'media',
          ...(acciones[area] ? { accion: acciones[area] } : {}),
        };
      });
    const modos: ModoMejora[] = ['conservador', 'reestructurar', 'reescribir'];
    const diagnostico: Diagnostico = {
      resumen: String(r.resumen),
      puntosFuertes: (r.puntosFuertes ?? []).map(String).filter(Boolean),
      problemas,
      recomendacion: modos.includes(r.recomendacion as ModoMejora) ? (r.recomendacion as ModoMejora) : 'conservador',
      motivoRecomendacion: String(r.motivoRecomendacion ?? ''),
      actualizado: new Date().toISOString(),
    };
    await this.almacen.escribirJsonDoc(asig, doc, 'diagnostico.json', diagnostico);
    const altas = problemas.filter((p) => p.gravedad === 'alta').length;
    return `Diagnóstico listo: ${problemas.length} ${problemas.length === 1 ? 'aspecto' : 'aspectos'} que mejorar${altas ? ` (${altas} importantes)` : ''}`;
  }

  /**
   * Cambia de modo unos apuntes importados en modo conservador: el texto actual pasa a ser la fuente
   * principal y el arquitecto propone un índice nuevo (las secciones actuales se conservan hasta
   * que se apruebe y se redacte el nuevo).
   */
  async cambiarModo(asig: string, doc: string, modo: ModoMejora) {
    if (modo === 'conservador') throw new ErrorUsuario('Para seguir sobre el texto actual no hace falta cambiar nada');
    const documento = await this.almacen.obtenerDocumento(asig, doc);
    const textos = (await this.almacen.textoCompleto(asig, doc)).filter((x) => !ARCHIVO_AUTOEVALUACION.test(x.archivo));
    if (!textos.length) throw new ErrorUsuario('El documento no tiene texto');
    await fs.writeFile(path.join(this.almacen.dirFuentes(asig, doc), 'apuntes-originales.md'), textos.map((x) => x.texto.trim()).join('\n\n'), 'utf8');
    const importado: Importacion = documento.importado
      ? { ...documento.importado, modo, formato: documento.importado.formato === 'pdf' ? 'md' : documento.importado.formato }
      : { archivo: 'apuntes-originales.md', formato: 'md', modo, fecha: new Date().toISOString() };
    await this.almacen.actualizarDocumento(asig, doc, { importado });
    return this.proponerIndice(asig, doc);
  }
}
