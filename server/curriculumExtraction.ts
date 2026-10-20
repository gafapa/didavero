import type { Asignatura } from '../shared/tipos';
import type { CurriculumProfile } from '../shared/curriculum';

export function suggestedCurriculumProfile(subject: Asignatura): CurriculumProfile {
  const now = new Date();
  const year = now.getFullYear() - (now.getMonth() < 8 ? 1 : 0);
  const vocational = !!subject.etapa?.startsWith('fp-');
  return { stage: subject.etapa ?? '', territory: subject.comunidad || 'Estatal', academicYear: `${year}-${year + 1}`,
    subject: subject.nombre, course: subject.curso || subject.nivel || '', scope: vocational ? 'module' : 'course',
    model: vocational ? 'vocational' : 'general', qualification: subject.titulo || '', moduleCode: '' };
}

/** Generate each literal passage once; expand repetitive metadata locally. */
export function curriculumExtractionTask(profile: CurriculumProfile, output: string): string {
  const rootKind = profile.model === 'vocational' ? 'learningOutcome' : 'specificCompetence';
  return `Extrae el currículo oficial de este perfil exacto: ${JSON.stringify(profile)}.
No consultes los documentos, fuentes privadas ni contexto del centro. El perfil prevalece sobre la ficha general.

1. IDENTIFICAR: verifica en publicaciones oficiales norma, anexos, modificaciones, vigencia e implantación para este curso. Usa búsquedas dirigidas y el enlace directo a la materia/módulo. Prioriza HTML; en PDF lee solo el apartado y su continuación, no vuelques boletines enteros. Reutiliza fuentes ya abiertas, sin búsquedas repetidas ni transcribir normas generales ajenas al perfil. No uses memoria, resúmenes ni fragmentos del buscador como fuente normativa. Distingue proyectos de normas publicadas; no dupliques mínimos estatales y concreción autonómica. Ceuta/Melilla: ámbito del Ministerio. Primaria: respeta el ciclo si no hay distribución oficial por curso. FP: módulos profesionales con RA/CE; ámbitos generales de Grado Básico con competencias/criterios/saberes. Identifica moduleCode en la norma si falta; devuélvelo en resolvedModuleCode y conserva los códigos ya conocidos.
2. INVENTARIAR ANTES DE TRANSCRIBIR: cuenta desde la fuente RA/competencias, criterios de cada padre, bloques/subbloques y contenidos de cada bloque. No derives expectedCount del JSON. Sigue todas las continuaciones de tablas.
3. TRANSCRIBIR: conserva íntegramente textos, lengua (no traduzcas), códigos, símbolos, negaciones y jerarquía; recompón solo saltos de maquetación. Cada viñeta es un elemento. No resumas ni fabriques textos.
4. RECONCILIAR: contrasta inventario, elementos, padres y localizaciones sobre lo ya consultado; completa omisiones sin otra búsqueda general.

Jerarquías independientes: ${rootKind} → assessmentCriterion; contentBlock → knowledge o subbloques contentBlock. descriptor depende de keyCompetence. Bloques y RA/competencias son raíces independientes. Las correspondencias expresas van en links, sin deducir relaciones temáticas. Tipos: objective, keyCompetence, descriptor, specificCompetence, learningOutcome, assessmentCriterion, contentBlock, knowledge.

Escribe SOLO en \`${output}\` JSON compacto sin sangría, nunca en curriculum/state.json ni otros archivos. No expliques el proceso en tu respuesta. Formato:
{"sources":[{"id":"s1","title":"Nombre de la norma","url":"https://enlace-oficial","publishedOn":"AAAA-MM-DD","applicableFrom":"Curso/fecha"}],"elements":[{"id":"e1","kind":"${rootKind}","code":"Código original","text":"Texto literal completo","parentId":"","sourceId":"s1","locator":"Anexo, materia/módulo, curso y página/apartado"}],"links":[],"resolvedModuleCode":"${profile.moduleCode}","audit":{"status":"complete","inventory":[{"kind":"${rootKind}","parentId":"","sourceId":"s1","locator":"Apartado contado","expectedCount":1}],"content":{"status":"published","sourceId":"s1","locator":"Apartado de contenidos"}}}
El ejemplo solo ilustra el formato: incluye TODOS los elementos y grupos comprobados, con IDs únicos estables. Un grupo inventory por kind+parentId+sourceId, sin duplicados ni elementos sin inventariar. Cada expectedCount procede de la fuente. Elementos: id, kind, code, text, parentId, sourceId, locator. code vacío en bloques/contenidos sin código normativo: la app los numera localmente.
Ahorra tokens: omite excerpt si es idéntico a text (se copia localmente); conserva íntegro el texto normativo. Omite notes, reviewed, completenessReviewed, filename y origin si no aportan información: se completan con vacío, false y official. Si el fragmento original difiere, incluye excerpt literal para contrastarlo. El resultado se guarda como borrador sin revisión docente.
Si no se publican contenidos, audit.content.status="notPublished" requiere explanation detallada del apartado comprobado. Relaciones expresas: {"id":"r1","fromId":"e1","toId":"e2","origin":"official","sourceId":"s1","locator":"Apartado","notes":"Correspondencia expresa"}.
Si identificas la norma y el texto del módulo/materia, EXTRÁELOS aunque falte comprobar su aplicación temporal: audit.status="reviewRequired", audit.questions=["Comprobación concreta pendiente"] y conserva sources, elements, links e inventario completos. applicableFrom describe lo acreditado por la fuente, sin afirmar vigencia no verificada. Una disposición transitoria puede mantener currículos: compruébala; una derogación general no basta para descartar el anexo. No bloquees una extracción identificada solo porque no se abre una instrucción anual. El borrador seguirá sin revisar y las dudas quedarán en sus fuentes.
Usa {"audit":{"status":"needsInformation","questions":["Dato concreto que falta"]}} solo si no puedes identificar la materia/módulo o su texto normativo. No fabriques textos ni recuentos; reviewRequired no permite omitir elementos.`;
}
