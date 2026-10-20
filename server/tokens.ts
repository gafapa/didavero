// Contador de tokens consumidos por los agentes (total y del día), guardado junto a los ajustes.
import fs from 'node:fs';
import type { ContadorTokens, GastoAsignatura, Motor, Tokens, Trabajo } from '../shared/tipos';
import { writeFileAtomic } from './atomicFiles';
import { ErrorUsuario } from './store';

const cero = (): Tokens => ({ entrada: 0, salida: 0, cache: 0 });
const hoy = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const sumar = (a: Tokens, b: Tokens): Tokens => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, cache: a.cache + b.cache });

function getEntry<T>(record: Record<string, T>, key: string, factory: () => T): T {
  if (!Object.hasOwn(record, key)) Object.defineProperty(record, key, { value: factory(), configurable: true, enumerable: true, writable: true });
  return record[key];
}

function vacio(): ContadorTokens {
  return { desde: new Date().toISOString(), total: { claude: cero(), codex: cero(), opencode: cero() }, hoy: { fecha: hoy(), porMotor: { claude: cero(), codex: cero(), opencode: cero() } }, porAsignatura: {}, porAgente: {} };
}

export class Contador {
  private datos: ContadorTokens;
  private temporizador?: NodeJS.Timeout;

  constructor(private archivo: string) {
    try {
      const leido = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      if (!leido || typeof leido !== 'object' || !leido.total || !leido.hoy?.porMotor) throw new Error('Invalid counter data');
      this.datos = { ...vacio(), ...leido, total: { ...vacio().total, ...leido.total }, hoy: { ...leido.hoy, porMotor: { ...vacio().hoy.porMotor, ...leido.hoy.porMotor } } };
      // Contador antiguo, sin desglose: se siembra con los trabajos que se conservan
      if (!leido.porAsignatura) delete this.datos.porAsignatura;
      if (!leido.porAgente) delete this.datos.porAgente;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ErrorUsuario('El contador de uso está dañado; recupéralo desde una copia de seguridad', 409);
      this.datos = vacio();
    }
  }

  /** Estado actual (si ha cambiado el día, el contador de hoy empieza de cero). */
  leer(): ContadorTokens {
    if (this.datos.hoy.fecha !== hoy()) this.datos.hoy = { fecha: hoy(), porMotor: { claude: cero(), codex: cero(), opencode: cero() } };
    return this.datos;
  }

  sumar(motor: Motor, t: Tokens, asignatura?: string, documento?: string, agente?: string) {
    const d = this.leer();
    d.total[motor] = sumar(d.total[motor] ?? cero(), t);
    d.hoy.porMotor[motor] = sumar(d.hoy.porMotor[motor] ?? cero(), t);
    if (asignatura) this.sumarA(motor, t, asignatura, documento);
    if (agente) {
      const a = getEntry(d.porAgente ??= {}, agente, () => ({ llamadas: 0, ...cero() }));
      Object.assign(a, sumar(a, t));
    }
    this.guardar();
  }

  /** Una llamada más a un agente (cada vez que termina un trabajo o una respuesta). */
  llamada(agente: string) {
    const a = getEntry(this.datos.porAgente ??= {}, agente, () => ({ llamadas: 0, ...cero() }));
    a.llamadas++;
    this.guardar();
  }

  private sumarA(motor: Motor, t: Tokens, asignatura: string, documento?: string) {
    const por = (this.datos.porAsignatura ??= {});
    const a: GastoAsignatura = getEntry(por, asignatura, () => ({ total: { claude: cero(), codex: cero(), opencode: cero() }, documentos: {} }));
    a.total[motor] = sumar(a.total[motor] ?? cero(), t);
    if (documento) {
      const doc = getEntry(a.documentos, documento, () => ({ claude: cero(), codex: cero(), opencode: cero() }));
      doc[motor] = sumar(doc[motor] ?? cero(), t);
    }
  }

  /**
   * La primera vez (contadores de antes de existir el desglose), reparte por asignatura y documento
   * lo que consta en los trabajos que todavía se conservan.
   */
  sembrar(trabajos: Trabajo[]) {
    if (!this.datos.porAsignatura) {
      this.datos.porAsignatura = {};
      for (const t of trabajos) if (t.tokens && t.asignatura) this.sumarA(t.motor, t.tokens, t.asignatura, t.documento);
    }
    if (!this.datos.porAgente) {
      this.datos.porAgente = {};
      for (const t of trabajos) {
        const a = getEntry(this.datos.porAgente, t.agente, () => ({ llamadas: 0, ...cero() }));
        a.llamadas++;
        if (t.tokens) Object.assign(a, sumar(a, t.tokens));
      }
    }
    this.guardar();
  }

  reiniciar() {
    this.datos = vacio();
    this.guardar();
  }

  private guardar() {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => { void this.flush().catch(() => console.error('Unable to persist token usage')); }, 500);
  }

  async flush() {
    clearTimeout(this.temporizador);
    this.temporizador = undefined;
    await writeFileAtomic(this.archivo, JSON.stringify(this.datos));
  }
}
