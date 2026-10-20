// Tareas de la asignatura: buscador de fuentes, currículo oficial y glosario.
import type { ResultadoBusqueda, TipoBusqueda } from '../../shared/tipos';
import { ErrorUsuario } from '../store';
import { DESCRIPCION_TIPO, descargarFuente, guardarResultados, leerResultados } from '../buscador';
import { FlujoImportacion } from './importacion';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Trabajo } from '../../shared/tipos';
import type { CurriculumProfile } from '../../shared/curriculum';
import { curriculumProfileFromContext } from '../../shared/curriculum';
import { parseCurriculumDraft } from '../curriculumStore';
import { suggestedCurriculumProfile, curriculumExtractionTask } from '../curriculumExtraction';
import { extraerJson } from '../texto';
import { PedirAlAgente } from '../agents/cola';
import { reviewCurriculumExtraction, CurriculumNeedsInformation } from '../curriculumExtractionReview';

export class FlujoAsignatura extends FlujoImportacion {

  // ---------------------------------------------------------------------------
  // Buscador de fuentes (para la asignatura o para un documento)

  protected dirBusqueda(asig: string, doc?: string) {
    return doc ? this.almacen.dirDocumento(asig, doc) : this.almacen.dirAsignatura(asig);
  }

  async buscarFuentes(asig: string, doc: string | undefined, consulta: string, tipo: TipoBusqueda = 'cualquiera') {
    if (!consulta.trim()) throw new ErrorUsuario('Escribe qué fuentes buscas');
    if (this.ocupado('fuentes', asig, doc)) throw new ErrorUsuario('Ya hay una búsqueda en curso');
    const salida = this.salida('fuentes');
    const ya = (await leerResultados(this.dirBusqueda(asig, doc))).map((r) => r.url);
    return this.lanzar({
      agente: 'investigador',
      asignatura: asig,
      documento: doc,
      titulo: `Buscar fuentes: ${consulta.trim().slice(0, 80)}`,
      paso: 'fuentes',
      esfuerzo: 'low', // basta con buscar y elegir; la app comprueba los enlaces
      tarea: `Busca en la web fuentes para elaborar los apuntes${doc ? ' de este documento' : ' de esta asignatura'} sobre: «${consulta.trim()}».
Tipo de fuentes: ${DESCRIPCION_TIPO[tipo] ?? DESCRIPCION_TIPO.cualquiera}.

- Entre 5 y 10 resultados, los mejores, adecuados al nivel y a los destinatarios.
- Solo fuentes fiables y verificables (instituciones, universidades, editoriales, revistas, organismos oficiales, divulgadores reconocidos). Nada de webs de trabajos copiados ni contenido generado sin autoría.
- Usa la búsqueda web y elige a partir de los resultados. NO abras las páginas para comprobarlas: la aplicación verifica después cada enlace. Ábrelas solo si necesitas averiguar la URL directa de un PDF.
- Copia las URL tal cual aparecen en los resultados. Prefiere contenidos de acceso libre.
${ya.length ? `- No repitas estas URL, ya propuestas antes:\n${ya.slice(0, 40).map((u) => `  - ${u}`).join('\n')}\n` : ''}
No descargues nada ni modifiques otros archivos. Escribe los resultados en \`${salida}\` con este JSON exacto:

{
  "resultados": [
    {
      "titulo": "Título del recurso",
      "url": "https://…",
      "autor": "autor u organización",
      "tipo": "pdf | web | video | articulo | libro",
      "descripcion": "qué contiene y para qué sirve en estos apuntes (1-2 frases)",
      "fiabilidad": "por qué es fiable (breve)",
      "idioma": "es, en…",
      "licencia": "si se conoce (CC BY, dominio público…), si no, cadena vacía"
    }
  ]
}`,
      post: { tipo: 'busqueda', datos: { salida, consulta: consulta.trim() } },
    });
  }

  async resultadosBusqueda(asig: string, doc?: string) {
    return leerResultados(this.dirBusqueda(asig, doc));
  }

  protected async cambiarResultado(asig: string, doc: string | undefined, id: string, cambios: Partial<ResultadoBusqueda>) {
    const dir = this.dirBusqueda(asig, doc);
    return this.conCandado(`${dir}/busqueda`, async () => {
      const lista = await leerResultados(dir);
      const r = lista.find((x) => x.id === id);
      if (!r) throw new ErrorUsuario('Resultado no encontrado', 404);
      Object.assign(r, cambios);
      await guardarResultados(dir, lista);
      return r;
    });
  }

  async anadirFuente(asig: string, doc: string | undefined, id: string) {
    const r = (await leerResultados(this.dirBusqueda(asig, doc))).find((x) => x.id === id);
    if (!r) throw new ErrorUsuario('Resultado no encontrado', 404);
    try {
      const archivo = await descargarFuente(r, this.almacen.dirFuentes(asig, doc), this.dep.dirBin ?? '');
      await this.prepararFuentes(asig, doc);
      return this.cambiarResultado(asig, doc, id, { estado: 'anadida', archivo, error: undefined });
    } catch (e) {
      await this.cambiarResultado(asig, doc, id, { error: (e as Error).message });
      throw e;
    }
  }

  async descartarResultado(asig: string, doc: string | undefined, id: string) {
    return this.cambiarResultado(asig, doc, id, { estado: 'descartada' });
  }

  async limpiarBusqueda(asig: string, doc?: string) {
    const dir = this.dirBusqueda(asig, doc);
    return this.conCandado(`${dir}/busqueda`, async () => {
      await guardarResultados(dir, (await leerResultados(dir)).filter((r) => r.estado === 'anadida'));
    });
  }

  // ---------------------------------------------------------------------------
  // Glosario de la asignatura

  /** Extract a reviewable proposal without replacing the active curriculum. */
  async buscarCurriculo(asig: string, indicaciones?: string, options?: { profile?: CurriculumProfile }) {
    if (this.ocupado('curriculo', asig, undefined)) throw new ErrorUsuario('Ya se está buscando el currículo');
    const subject = await this.almacen.obtenerAsignatura(asig);
    const store = this.almacen.curriculum(asig);
    const state = await store.read();
    if (state.draft && (state.draft.elements.length || state.draft.sources.length || state.draft.links.length)) throw new ErrorUsuario('Ya hay un borrador. Revísalo y actívalo antes de iniciar otra extracción.');
    const contextProfile = suggestedCurriculumProfile(subject);
    const requestedProfile = parseCurriculumDraft({ profile: options?.profile ?? contextProfile, sources: [], elements: [], links: [] }).profile;
    const profile = curriculumProfileFromContext(requestedProfile, contextProfile);
    if (!profile.stage || !profile.course || !/^\d{4}-\d{4}$/.test(profile.academicYear)) throw new ErrorUsuario('Completa la enseñanza, curso o ciclo y curso académico antes de buscar.');
    const output = this.salida('curriculum');
    return this.lanzar({
      agente: 'curriculo',
      asignatura: asig,
      titulo: 'Obtener el currículo estructurado',
      paso: 'curriculo',
      web: true,
      fuentes: false,
      esfuerzo: 'medium',
      indicaciones,
      tarea: curriculumExtractionTask(profile, output),
      post: { tipo: 'curriculo', datos: { output, expectedRevision: state.revision, profile } },
    });
  }

  protected async postStructuredCurriculum(job: Trabajo, data: Record<string, unknown>) {
    const store = this.almacen.curriculum(job.asignatura);
    if ((await store.read()).appliedJobs.includes(job.id)) return 'Propuesta de currículo ya incorporada.';
    let result: unknown;
    try {
      const directory = this.almacen.dirAsignatura(job.asignatura);
      const output = path.resolve(directory, String(data.output));
      if (!output.startsWith(path.resolve(directory, '.agentes') + path.sep)) throw new Error('Invalid output path');
      const stat = await fs.stat(output);
      if (stat.size > 20 * 1024 * 1024) throw new Error('El resultado supera los 20 MB. Extrae solo la materia o módulo solicitado.');
      result = reviewCurriculumExtraction(extraerJson(await fs.readFile(output, 'utf8')), data.profile as CurriculumProfile);
    } catch (error) {
      if (error instanceof CurriculumNeedsInformation) throw new ErrorUsuario(error.message);
        throw new PedirAlAgente('La extracción del currículo necesita correcciones.', `Corrige SOLO el JSON de ${String(data.output)} usando las fuentes ya consultadas. Conserva textos correctos e IDs; no alteres el inventario para ocultar omisiones. Consulta de nuevo solo el apartado que falte, sin repetir la búsqueda general. Omite excerpt si coincide con text. Comprobaciones fallidas:\n${(error as Error).message.slice(0, 3000)}`);
    }
    await store.acceptExtraction(result, Number(data.expectedRevision), job.id);
    const pendingApplicability = (result as { sources: { notes: string }[] }).sources.some((source) => source.notes.includes('Pendiente de verificar la aplicabilidad'));
    return pendingApplicability
      ? 'Borrador guardado con la aplicabilidad temporal pendiente. Revisa las dudas indicadas en Fuentes, contrasta los textos y comprueba la integridad antes de activarlo.'
      : 'Borrador estructurado guardado. Revisa los elementos, relaciones y fuentes y comprueba su integridad antes de activarlo.';
  }

  async glosario(asig: string, indicaciones?: string) {
    if (this.ocupado('glosario', asig, undefined)) throw new ErrorUsuario('Ya se está actualizando el glosario');
    return this.lanzar({
      agente: 'glosario',
      asignatura: asig,
      titulo: 'Actualizar el glosario',
      paso: 'glosario',
      indicaciones,
      tarea: `Actualiza el glosario de la asignatura en \`glosario.md\` a partir de todos los documentos (\`documentos/*/secciones/*.md\`) y de su contexto.
- Formato: \`# Glosario\` y, en orden alfabético, una entrada por término: \`**Término**: definición breve y precisa.\` Añade al final \`## Notación y abreviaturas\` si procede.
- Conserva las entradas existentes (mejóralas si hace falta) y añade las nuevas.
- Si detectas el mismo concepto con nombres o notaciones distintas entre documentos, indícalo al final en \`## Incoherencias detectadas\` señalando dónde aparece cada variante.
Solo escribe en \`glosario.md\`; no modifiques los documentos.`,
    });
  }
}
