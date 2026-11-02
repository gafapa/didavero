// Prepara la exportación: convierte los diagramas Mermaid del documento a PNG
// (Pandoc no sabe dibujarlos) y los envía al servidor junto con las opciones.
import { ESCALA_DIAGRAMAS, PATRON_MERMAID, hashTexto } from '../../../shared/hash';
import type { OpcionesExportacion } from '../../../shared/tipos';
import { api, urlDatos } from './api';
import { PATRON_MOLECULA, consultaMolecula } from '../../../shared/quimica';
import { dibujarMolecula, resolverMolecula } from './moleculas';
import { PATRON_BLOQUE, claveBloque, type TipoBloque } from '../../../shared/bloques';
import { dibujarBloque } from './bloques';
import { registrarIconos } from './mermaidIconos';
import { flushPendingEdits } from './pendingEdits';

let contador = 0;

async function svgAPng(svg: string, escala = ESCALA_DIAGRAMAS): Promise<string> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const raiz = doc.documentElement;
  const vb = raiz.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const ancho = vb?.[2] || parseFloat(raiz.getAttribute('width') ?? '') || 800;
  const alto = vb?.[3] || parseFloat(raiz.getAttribute('height') ?? '') || 600;
  raiz.setAttribute('width', String(ancho));
  raiz.setAttribute('height', String(alto));
  raiz.removeAttribute('style');
  const blob = new Blob([new XMLSerializer().serializeToString(raiz)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((ok, mal) => {
      img.onload = () => ok();
      img.onerror = () => mal(new Error('No se pudo convertir el diagrama'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(ancho * escala);
    canvas.height = Math.round(alto * escala);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(escala, escala);
    ctx.drawImage(img, 0, 0, ancho, alto);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ancho/alto de un SVG según su viewBox. */
function proporcion(svg: string): number {
  const vb = svg.match(/viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)"/);
  return vb ? Number(vb[1]) / Math.max(1, Number(vb[2])) : 1;
}

/** Dibuja cada diagrama con tema claro y etiquetas SVG puras (sin HTML), que se pueden rasterizar. */
export async function diagramasAPng(textos: string[]): Promise<Record<string, string>> {
  const codigos = new Map<string, string>();
  for (const t of textos) {
    for (const m of t.matchAll(PATRON_MERMAID)) codigos.set(hashTexto(m[1].trim()), m[1].trim());
  }
  if (!codigos.size) return {};
  const mermaid = (await import('mermaid')).default;
  registrarIconos(mermaid);
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: 'Arial, Helvetica, sans-serif',
  });
  const res: Record<string, string> = {};
  try {
    for (const [hash, codigo] of codigos) {
      try {
        let { svg } = await mermaid.render(`exp-${++contador}`, codigo);
        // Un diagrama muy apaisado queda como una tira con letra diminuta en una página vertical:
        // si es un flujo horizontal, se prueba de arriba abajo y se elige el que mejor encaja
        const apaisado = proporcion(svg) > 3;
        const horizontal = /^\s*(flowchart|graph)\s+(LR|RL)\b/m;
        if (apaisado && horizontal.test(codigo)) {
          try {
            const alternativo = (await mermaid.render(`exp-${++contador}`, codigo.replace(horizontal, (_m, tipo) => `${tipo} TB`))).svg;
            const ideal = 1.4; // ancho/alto que mejor ocupa media página
            if (Math.abs(Math.log(proporcion(alternativo) / ideal)) < Math.abs(Math.log(proporcion(svg) / ideal))) svg = alternativo;
          } catch {}
        }
        res[hash] = await svgAPng(svg);
      } catch (e) {
        console.warn('Diagrama no exportable', e);
      }
    }
  } finally {
    // Restaurar la configuración de la vista previa
    const oscuro = document.documentElement.classList.contains('dark');
    mermaid.initialize({ startOnLoad: false, theme: oscuro ? 'dark' : 'default', securityLevel: 'strict', fontFamily: 'Inter Variable' });
  }
  return res;
}

/**
 * Dibuja cada molécula en PNG. Clave: «m» + hash de su consulta (el servidor la busca igual).
 * Las que no se pueden resolver o dibujar se omiten (el servidor pone un aviso en su lugar).
 */
export async function moleculasAPng(textos: string[]): Promise<Record<string, string>> {
  const consultas = new Set<string>();
  for (const t of textos) for (const m of t.matchAll(PATRON_MOLECULA)) consultas.add(consultaMolecula(m[1]));
  const res: Record<string, string> = {};
  for (const consulta of consultas) {
    if (!consulta) continue;
    try {
      const m = await resolverMolecula(consulta);
      res[`m${hashTexto(consulta)}`] = await svgAPng(await dibujarMolecula(m.smiles));
    } catch (e) {
      console.warn('Molécula no exportable', consulta, e);
    }
  }
  return res;
}

/**
 * Dibuja en PNG los bloques (gráficas, mapas, árboles sintácticos, partituras, SVG, pictogramas,
 * imágenes con etiquetas). Los que fallan se omiten: el servidor pone un aviso en su lugar.
 */
export async function bloquesAPng(textos: string[], base: string): Promise<Record<string, string>> {
  const bloques = new Map<string, { tipo: TipoBloque; contenido: string }>();
  for (const t of textos) {
    for (const m of t.matchAll(PATRON_BLOQUE)) bloques.set(claveBloque(m[1] as TipoBloque, m[2]), { tipo: m[1] as TipoBloque, contenido: m[2] });
  }
  const res: Record<string, string> = {};
  for (const [clave, b] of bloques) {
    try {
      res[clave] = await svgAPng(await dibujarBloque(b.tipo, b.contenido, { oscuro: false, base }), b.tipo === 'pictogramas' || b.tipo === 'etiquetas' ? 2 : ESCALA_DIAGRAMAS);
    } catch (e) {
      console.warn(`Bloque «${b.tipo}» no exportable`, e);
    }
  }
  return res;
}

export async function exportarDocumento(asignatura: string, documento: string, opciones: OpcionesExportacion) {
  await flushPendingEdits(`${asignatura}/${documento}`);
  const secciones = await api.secciones(asignatura, documento);
  const textos = await Promise.all(secciones.map((s) => api.leerSeccion(asignatura, documento, s.archivo).then((r) => r.contenido)));
  const base = urlDatos(asignatura, 'documentos', documento);
  const diagramas = { ...(await diagramasAPng(textos)), ...(await moleculasAPng(textos)), ...(await bloquesAPng(textos, base)) };
  return api.exportar(asignatura, documento, opciones, diagramas);
}
