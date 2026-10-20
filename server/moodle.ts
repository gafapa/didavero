// Actividades en formato GIFT, el que importan Moodle y las plataformas basadas en él (Aules,
// EducaMadrid, Educamos…): Banco de preguntas › Importar › Formato GIFT. Cada bloque va en su
// propia subcategoría.
import { tipoDe, type BloqueActividad, type PreguntaActividad, type TipoActividad } from '../shared/actividades';

/** Escapa los caracteres especiales de GIFT y pasa las fórmulas $…$ a la notación de MathJax de Moodle. */
function texto(s: string): string {
  return String(s ?? '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, f: string) => `\\\\[${f}\\\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_m, f: string) => `\\\\(${f}\\\\)`)
    .replace(/([~=#{}:])/g, '\\$1')
    .replace(/\n/g, '\\n')
    .trim();
}

/** Nombre de la pregunta en el banco: sin fórmulas ni formato. */
const plano = (s: string) =>
  s
    .replace(/\$+([^$]+)\$+/g, '$1')
    .replace(/[*_`\\]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .replace(/([~=#{}:])/g, '\\$1');

function pregunta(tipo: TipoActividad, p: PreguntaActividad, n: number): string {
  const cabecera = `::${String(n).padStart(2, '0')}. ${plano(p.enunciado || 'Relaciona')}::[markdown]`;
  const fb = p.explicacion ? `#${texto(p.explicacion)}` : '';
  switch (tipo) {
    case 'test': {
      const c = typeof p.correcta === 'number' ? p.correcta : 0;
      return [`${cabecera}${texto(p.enunciado)} {`, ...(p.opciones ?? []).map((o, k) => `  ${k === c ? '=' : '~'}${texto(o)}${k === c ? fb : ''}`), '}'].join('\n');
    }
    case 'multiple': {
      // Cada correcta suma su parte y cada incorrecta la resta (Moodle solo admite ciertos porcentajes)
      const correctas = new Set(p.correctas ?? []);
      const malas = (p.opciones?.length ?? 0) - correctas.size;
      const peso = (n: number) => (n ? String(Math.round((100 / n) * 100000) / 100000) : '0');
      return [
        `${cabecera}${texto(p.enunciado)} {`,
        ...(p.opciones ?? []).map((o, k) => `  ~%${correctas.has(k) ? peso(correctas.size) : `-${peso(malas)}`}%${texto(o)}`),
        ...(fb ? [`  ####${texto(p.explicacion ?? '')}`] : []),
        '}',
      ].join('\n');
    }
    case 'vf':
    case 'vfjustificada':
      return `${cabecera}${texto(p.enunciado)} {${p.correcta === false ? 'FALSE' : 'TRUE'}${fb}}`;
    case 'numerica':
      return `${cabecera}${texto(p.enunciado)}${p.unidades ? ` (${texto(p.unidades)})` : ''} {#${p.valor ?? 0}${p.tolerancia ? `:${p.tolerancia}` : ''}${fb}}`;
    case 'banco': {
      // Cada hueco con la palabra que le corresponde (GIFT no admite las palabras de más)
      const huecos = (p.respuestas ?? []).map((r, k) => `  =Hueco ${k + 1} -> ${texto(r)}`);
      let k = 0;
      const enunciado = p.enunciado.replace(/_{3,}/g, () => `(${++k}) ______`);
      return [`${cabecera}${texto(enunciado)} {`, ...huecos, '}'].join('\n');
    }
    case 'ordenar':
      // Cada elemento con su posición
      return [`${cabecera}${texto(p.enunciado || 'Ordena estos elementos.')} {`, ...(p.elementos ?? []).map((x, k) => `  =${texto(x)} -> ${k + 1}.º`), '}'].join('\n');
    case 'clasificar':
      return [
        `${cabecera}${texto(p.enunciado || 'Clasifica estos elementos.')} {`,
        ...(p.categorias ?? []).flatMap((c) => c.elementos.map((x) => `  =${texto(x)} -> ${texto(c.nombre)}`)),
        '}',
      ].join('\n');
    case 'corta':
      return [`${cabecera}${texto(p.enunciado)} {`, ...(p.respuestas ?? []).map((r) => `  =${texto(r)}${fb}`), '}'].join('\n');
    case 'huecos': {
      // Palabra que falta: el hueco se sustituye por las respuestas aceptadas
      const [antes, ...resto] = p.enunciado.split(/_{3,}/);
      const respuestas = (p.respuestas ?? []).map((r) => `=${texto(r)}`).join(' ');
      return resto.length ? `${cabecera}${texto(antes)} {${respuestas}${fb}} ${texto(resto.join('___'))}` : `${cabecera}${texto(p.enunciado)} {${respuestas}${fb}}`;
    }
    case 'emparejar':
      return [`${cabecera}${texto(p.enunciado || 'Relaciona cada elemento con su pareja.')} {`, ...(p.pares ?? []).map(([a, b]) => `  =${texto(a)} -> ${texto(b)}`), '}'].join('\n');
    default: {
      // Abiertas (y «encuentra el error»): de redacción, con la solución modelo como comentario general
      const material = p.material?.trim() ? `${p.material.trim()}\n\n` : '';
      const modelo = [p.respuestas?.join(' / '), p.explicacion].filter(Boolean).join('. ');
      return `${cabecera}${texto(material + p.enunciado)} {${modelo ? `####${texto(modelo)}` : ''}}`;
    }
  }
}

export function generarGift(bloques: BloqueActividad[], titulo: string): string {
  const raiz = titulo.replace(/[/\n]/g, ' ');
  const lineas: string[] = [`// Autoevaluación: ${titulo}`, '// Generado por Didavero', ''];
  let n = 0;
  for (const b of bloques) {
    lineas.push(`$CATEGORY: $course$/top/${raiz}/${b.titulo.replace(/[/\n]/g, ' ')}`, '');
    for (const p of b.preguntas) {
      lineas.push(pregunta(tipoDe(p, b), p, ++n), '');
    }
  }
  return lineas.join('\n');
}
