import { ENGINE_IDS, isEngine } from '../shared/engines';
// Servidor local: API REST, WebSocket de eventos y archivos estáticos de la interfaz.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type { Ajustes, EstadoMotor, HerramientasChat, PerfilGasto, SeleccionTexto, Trabajo, Indice, MensajeWS, MezclaVisuales, ModoMejora, Motor, OpcionesExportacion, PropuestaVisual, TipoBusqueda, TipoRevision } from '../shared/tipos';
import { Almacen, ErrorUsuario } from './store';
import { Cola } from './agents/cola';
import { readCodexUsage } from './agents/codexUsage';
import { acquireInstanceLock } from './instanceLock';
import { APPLICATION_CSP, isLocalRequestAllowed } from './localSecurity';
import { saveUpload } from './uploads';
import type { CurriculumProfile } from '../shared/curriculum';
import { suggestedCurriculumProfile } from './curriculumExtraction';
import { exportProgramme, PROGRAMME_EXPORT_MIMES } from './exportProgramme';
import { parseProgramme, parseProgrammePurpose } from './teachingProgrammeStore';
import type { CreateProgrammeRequest, ProgrammeExportFormat } from '../shared/teachingProgramme';
import { AGENTES } from './agents/agentes';
import { abrirArchivo, abrirCarpeta, abrirTerminal, comandoInstalacion, comandoSesion, comprobarMotor } from './agents/motores';
import { cargarAjustes, guardarAjustes } from './ajustes';
import { Flujo, type AmbitoChat, type TipoVersion } from './flujo';
import { Historial } from './historial';
import type { OpcionesActividad } from '../shared/actividades';
import { exportar } from './exportar';
import { exportarExamen, exportarExamenMoodle, listarExportadosExamen, rutaExportadoExamen, type FormatoExamen } from './exportarExamen';
import type { OpcionesExamen, PreguntaExamen, ExamAdaptationRequest } from '../shared/examenes';
import { Contador } from './tokens';
import { plantillaBase } from './plantillaBase';
import { borrarDePapelera, crearCopia, duplicarAsignatura, duplicarDocumento, listarPapelera, reunirExportados, restaurarCopia, restaurarDePapelera } from './gestion';
import { Moleculas } from './moleculas';
import { Arasaac } from './arasaac';
import { Fronteras } from './fronteras';
import { rutaPandoc } from './conversion';
import { ESFUERZOS, PERFILES, modelosDisponibles, preset } from './agents/modelos';
import { buscarImagenes, miniatura, type ResultadoImagen } from './imagenesWeb';
import { buscar as buscarRag, indexar } from './rag';

export interface OpcionesServidor {
  codexUsageReader?: typeof readCodexUsage;
  archivoAjustes: string; // dónde se guardan los ajustes (fuera de la carpeta de datos)
  carpetaDatosPorDefecto: string;
  dirEstatico?: string; // interfaz compilada (en desarrollo la sirve Vite)
  dirBin?: string; // Pandoc y Typst
  version?: string;
  dirTrabajos?: string; // dónde se guardan los trabajos de los agentes (por defecto, junto a los ajustes)
  /** Cómo lanzar el servidor MCP de búsqueda en las fuentes (dist/mcp-fuentes.cjs). */
  mcpFuentes?: { comando: string; args: string[]; env?: Record<string, string> };
  /** Reinicia la app instalando la actualización descargada (solo en la app empaquetada). */
  instalarActualizacion?: () => void;
  puerto?: number;
  host?: string;
}

export async function crearServidor(op: OpcionesServidor) {
  let ajustes = await cargarAjustes(op.archivoAjustes, op.carpetaDatosPorDefecto);
  let almacen = new Almacen(ajustes.carpetaDatos);
  await almacen.iniciar();
  // Los trabajos se guardan junto a los ajustes, para sobrevivir a reinicios del servidor
  const dirTrabajos = op.dirTrabajos ?? path.join(path.dirname(op.archivoAjustes), 'trabajos');
  const releaseInstance = await acquireInstanceLock(dirTrabajos);
  try {
  const cola = new Cola(ajustes.maxSimultaneos, dirTrabajos);
  const contador = new Contador(path.join(path.dirname(op.archivoAjustes), 'tokens.json'));
  const dirBin = op.dirBin ?? '';

  // Estado de los motores (se refresca al consultarlo desde la interfaz)
  let motores: EstadoMotor[] = [];
  let engineCheck: Promise<EstadoMotor[]> | undefined;
  const refrescarMotores = () => {
    engineCheck ??= Promise.all(ENGINE_IDS.map(comprobarMotor))
      .then(result => (motores = result))
      .finally(() => { engineCheck = undefined; });
    return engineCheck;
  };
  refrescarMotores().catch(() => {});
  const motoresListos = () => new Set(motores.filter((m) => m.instalado && m.sesion).map((m) => m.motor));

  const moleculas = new Moleculas(path.join(path.dirname(op.archivoAjustes), 'moleculas.json'));
  const arasaac = new Arasaac(path.join(path.dirname(op.archivoAjustes), 'arasaac'));
  const fronteras = new Fronteras(path.join(path.dirname(op.archivoAjustes), 'fronteras'));
  // Versiones de las secciones: se guardan al cambiar los archivos (lo que haga quien los cambie)
  const historial = new Historial(() => almacen.raiz);
  const flujo = new Flujo({
    almacen: () => almacen,
    cola,
    ajustes: () => ajustes,
    motoresListos,
    dirBin,
    mcpFuentes: op.mcpFuentes,
    moleculas,
    gastoDocumento: (asig, doc) =>
      Object.values(contador.leer().porAsignatura?.[asig]?.documentos[doc] ?? {}).reduce((n, t) => n + t.entrada + t.salida, 0),
  });
  await cola.cargar(); // retoma los trabajos que seguían en marcha
  contador.sembrar(cola.listar());
  cola.on('terminado', (t: Trabajo) => contador.llamada(t.agente));

  const app = Fastify({ logger: false, bodyLimit: 80 * 1024 * 1024, routerOptions: { maxParamLength: 512 } });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // ---------- Seguridad: solo peticiones desde la propia app ----------
  // Una web cualquiera abierta en el navegador podría intentar llamar a localhost.
  // Y una web cuyo dominio apunte a 127.0.0.1 (DNS rebinding) pasaría por «propia»: el Host tiene que
  // ser local.
  app.addHook('onRequest', async (req, rep) => {
    const webPort = op.dirEstatico ? undefined : process.env.APUNTES_PUERTO_WEB ?? '5173';
    if (!isLocalRequestAllowed(req.headers.host ?? '', req.headers.origin, req.headers['sec-fetch-site'] as string | undefined, webPort)) return rep.code(403).send({ error: 'Origen o Host no permitido' });
  });
  app.addHook('preValidation', async req => {
    if (req.headers['content-type']?.startsWith('application/json') && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) throw new ErrorUsuario('La petición debe contener un objeto JSON');
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (op.dirEstatico && !reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', APPLICATION_CSP);
    return payload;
  });

  app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, _req, rep) => {
    const status = err instanceof ErrorUsuario ? err.status : err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    const msg = err.message || 'Error inesperado';
    rep.code(status).send({ error: status >= 500 ? 'Error interno del servidor' : err instanceof ErrorUsuario ? msg : status === 404 ? 'No encontrado' : msg });
  });

  // ---------- WebSocket ----------
  const clientes = new Set<WebSocket>();
  const difundir = (m: MensajeWS) => {
    const s = JSON.stringify(m);
    for (const c of clientes) if (c.readyState === 1) c.send(s);
  };
  cola.on('trabajo', (trabajo) => difundir({ tipo: 'trabajo', trabajo: { ...trabajo, eventos: [] } }));
  cola.on('evento', (id, evento) => difundir({ tipo: 'evento', id, evento }));
  cola.on('uso', (uso) => difundir({ tipo: 'uso', uso }));
  cola.on('tokens', (motor, tokens, t) => {
    contador.sumar(motor, tokens, t?.asignatura, t?.documento, t?.agente);
    difundir({ tipo: 'tokens', contador: contador.leer() });
  });

  app.get('/ws', { websocket: true }, (socket) => {
    clientes.add(socket);
    socket.on('close', () => clientes.delete(socket));
    if (cola.uso.actualizado) socket.send(JSON.stringify({ tipo: 'uso', uso: cola.uso } satisfies MensajeWS));
  });

  // ---------- Vigilancia de archivos (para refrescar cuando un agente escribe) ----------
  let vigilante: fs.FSWatcher | undefined;
  const pendientes = new Map<string, NodeJS.Timeout>();
  const vigilar = () => {
    vigilante?.close();
    historial.cebar().catch(() => {});
    try {
      vigilante = fs.watch(almacen.raiz, { recursive: true }, (_ev, archivo) => {
        if (!archivo) return;
        const ruta = String(archivo).replace(/\\/g, '/');
        if (ruta.split('/').some((p) => p.startsWith('.'))) return; // temporales, .agentes, .texto…
        clearTimeout(pendientes.get(ruta));
        pendientes.set(
          ruta,
          setTimeout(() => {
            pendientes.delete(ruta);
            const [asignatura, sub, documento] = ruta.split('/');
            historial.alCambiar(ruta).catch(() => {});
            difundir({ tipo: 'archivos', asignatura, documento: sub === 'documentos' ? documento : undefined, ruta });
          }, 250),
        );
      });
    } catch (e) {
      console.warn('No se pueden vigilar los archivos:', e);
    }
  };
  vigilar();

  // ---------- Ajustes y motores ----------
  app.get('/api/ajustes', async () => ajustes);
  app.put('/api/ajustes', async (req) => {
    const b = req.body as Partial<Ajustes>;
    const nuevo: Ajustes = { ...ajustes };
    if (typeof b.maxSimultaneos === 'number') nuevo.maxSimultaneos = Math.min(8, Math.max(1, Math.round(b.maxSimultaneos)));
    if (isEngine(b.motorPorDefecto)) nuevo.motorPorDefecto = b.motorPorDefecto;
    if (typeof b.asistenteCompletado === 'boolean') nuevo.asistenteCompletado = b.asistenteCompletado;
    if (typeof b.ocultarRequisitos === 'boolean') nuevo.ocultarRequisitos = b.ocultarRequisitos;
    if (b.agentes && typeof b.agentes === 'object') {
      nuevo.agentes = {};
      for (const [id, c] of Object.entries(b.agentes)) {
        if (!Object.hasOwn(AGENTES, id) || !c) continue;
        const motor = isEngine(c.motor) ? c.motor : undefined;
        const instrucciones = typeof c.instrucciones === 'string' && c.instrucciones.trim() ? c.instrucciones : undefined;
        const esfuerzo = c.esfuerzo === 'low' || c.esfuerzo === 'medium' || c.esfuerzo === 'high' ? c.esfuerzo : undefined;
        const modelo = typeof c.modelo === 'string' && /^[\w./:#-]{1,300}$/.test(c.modelo.trim()) ? c.modelo.trim() : undefined;
        if (motor || instrucciones || esfuerzo || modelo) nuevo.agentes[id] = { motor, instrucciones, esfuerzo, modelo };
      }
    }
    if (isEngine(b.modoMotor) || b.modoMotor === 'ambos') nuevo.modoMotor = b.modoMotor;
    if (typeof b.perfil === 'string' && Object.hasOwn(PERFILES, b.perfil)) nuevo.perfil = b.perfil;
    if (b.modelos && typeof b.modelos === 'object') {
      const modelos: NonNullable<Ajustes['modelos']> = {};
      for (const m of ENGINE_IDS) {
        const tabla = b.modelos[m];
        if (!tabla || typeof tabla !== 'object') continue;
        modelos[m] = {};
        for (const [agente, c] of Object.entries(tabla)) {
          if (!Object.hasOwn(AGENTES, agente) || !c || typeof c.modelo !== 'string' || !/^[\w./:#-]{0,300}$/.test(c.modelo)) continue;
          modelos[m]![agente] = { modelo: c.modelo, esfuerzo: c.esfuerzo && ESFUERZOS.includes(c.esfuerzo) ? c.esfuerzo : undefined };
        }
      }
      nuevo.modelos = modelos;
    }
    if (b.claves && typeof b.claves === 'object') {
      const clave = (v: unknown) => (typeof v === 'string' && /^[\w-]{3,100}$/.test(v.trim()) ? v.trim() : undefined);
      nuevo.claves = { europeana: clave(b.claves.europeana), smithsonian: clave(b.claves.smithsonian) };
    }
    if (typeof b.carpetaDatos === 'string' && b.carpetaDatos.trim() && b.carpetaDatos !== ajustes.carpetaDatos) {
      const dir = path.resolve(b.carpetaDatos.trim());
      await fsp.mkdir(dir, { recursive: true });
      nuevo.carpetaDatos = dir;
      almacen = new Almacen(dir);
      await almacen.iniciar();
      vigilar();
    }
    ajustes = nuevo;
    cola.maxSimultaneos = ajustes.maxSimultaneos;
    await guardarAjustes(op.archivoAjustes, ajustes);
    return ajustes;
  });

  app.get('/api/motores', async () => refrescarMotores());
  app.get('/api/version', async () => ({ version: op.version ?? 'desarrollo', actualizacion }));
  let actualizacion: { estado: 'disponible' | 'descargada'; version: string } | undefined;
  app.post('/api/actualizacion/instalar', async () => {
    if (!op.instalarActualizacion || actualizacion?.estado !== 'descargada') throw new ErrorUsuario('No hay ninguna actualización lista');
    setTimeout(() => op.instalarActualizacion!(), 300);
    return { ok: true };
  });
  app.post('/api/motores/:motor/:accion', async (req) => {
    const { motor, accion } = req.params as { motor: Motor; accion: string };
    if (!isEngine(motor)) throw new ErrorUsuario('Motor desconocido');
    if (accion === 'instalar') abrirTerminal(comandoInstalacion(motor));
    else if (accion === 'sesion') abrirTerminal(comandoSesion(motor));
    else throw new ErrorUsuario('Acción desconocida');
    return { ok: true };
  });
  app.get('/api/motores/:motor/comandos', async (req) => {
    const { motor } = req.params as { motor: Motor };
    if (!isEngine(motor)) throw new ErrorUsuario('Motor desconocido');
    return { instalar: comandoInstalacion(motor), sesion: comandoSesion(motor) };
  });

  app.post('/api/abrir-carpeta', async (req) => {
    const { asignatura, documento, sub } = (req.body ?? {}) as { asignatura?: string; documento?: string; sub?: string };
    let dir = almacen.raiz;
    if (asignatura) dir = documento ? almacen.dirDocumento(asignatura, documento) : almacen.dirAsignatura(asignatura);
    if (sub && ['fuentes', 'recursos', 'exportados', 'secciones'].includes(sub)) dir = path.join(dir, sub);
    if (!path.resolve(dir).startsWith(path.resolve(almacen.raiz))) throw new ErrorUsuario('Ruta no válida');
    await fsp.mkdir(dir, { recursive: true });
    abrirCarpeta(dir);
    return { ok: true };
  });

  // ---------- Asignaturas ----------
  type PA = { a: string };
  type PD = { a: string; d: string };
  type PS = PD & { s: string };

  app.get('/api/asignaturas', async () => almacen.listarAsignaturas());
  app.post('/api/asignaturas', async (req) => almacen.crearAsignatura(req.body as object));
  app.get('/api/asignaturas/:a', async (req) => almacen.obtenerAsignatura((req.params as PA).a));
  app.put('/api/asignaturas/:a', async (req) => almacen.actualizarAsignatura((req.params as PA).a, req.body as object));
  app.delete('/api/asignaturas/:a', async (req) => {
    await almacen.eliminarAsignatura((req.params as PA).a);
    return { ok: true };
  });

  // ---------- Documentos ----------
  app.post('/api/asignaturas/:a/documentos', async (req) => almacen.crearDocumento((req.params as PA).a, req.body as object));
  app.get('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.obtenerDocumento(a, d);
  });
  app.put('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.actualizarDocumento(a, d, req.body as object);
  });
  app.delete('/api/asignaturas/:a/documentos/:d', async (req) => {
    const { a, d } = req.params as PD;
    await almacen.eliminarDocumento(a, d);
    return { ok: true };
  });

  // ---------- Duplicar, papelera y copias de seguridad ----------
  app.post('/api/asignaturas/:a/duplicar', async (req) => {
    const id = await duplicarAsignatura(almacen, (req.params as PA).a, (req.body as { nombre?: string })?.nombre);
    return almacen.obtenerAsignatura(id);
  });
  app.post('/api/asignaturas/:a/documentos/:d/duplicar', async (req) => {
    const { a, d } = req.params as PD;
    return duplicarDocumento(almacen, a, d, (req.body ?? {}) as { titulo?: string; destino?: string });
  });
  app.get('/api/papelera', async () => listarPapelera(almacen));
  app.post('/api/papelera/:id/restaurar', async (req) => restaurarDePapelera(almacen, (req.params as { id: string }).id));
  app.delete('/api/papelera/:id', async (req) => {
    await borrarDePapelera(almacen, (req.params as { id: string }).id);
    return listarPapelera(almacen);
  });
  app.delete('/api/papelera', async () => {
    await borrarDePapelera(almacen);
    return [];
  });
  // Copia de seguridad: ?asignaturas=a,b (sin nada, todas)
  app.get('/api/copia', async (req, reply) => {
    const lista = String((req.query as { asignaturas?: string }).asignaturas ?? '').split(',').filter(Boolean);
    const flujoZip = await crearCopia(almacen, lista, op.version ?? 'desarrollo');
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = lista.length === 1 ? `${lista[0]}-copia-${fecha}.zip` : `apuntes-ia-copia-${fecha}.zip`;
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${nombre}"`).send(flujoZip);
  });
  app.post('/api/copia', async (req) => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'apuntes-copia-'));
    try {
      let uploaded = false;
      for await (const parte of req.parts()) {
        if (parte.type !== 'file') continue;
        if (uploaded) throw new ErrorUsuario('Sube una sola copia por petición');
        const ruta = path.join(tmp, 'copia.zip');
        await saveUpload(parte.file, ruta);
        uploaded = true;
      }
      if (!uploaded) throw new ErrorUsuario('Falta el archivo de la copia');
      return await restaurarCopia(almacen, path.join(tmp, 'copia.zip'));
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
  // Lo exportado de varios documentos, junto en una carpeta (que se abre)
  app.post('/api/asignaturas/:a/exportados/reunir', async (req) => {
    const archivos = ((req.body as { archivos?: { documento: string; nombre: string }[] })?.archivos ?? []).filter((f) => f?.documento && f?.nombre);
    const dir = await reunirExportados(almacen, (req.params as PA).a, archivos);
    abrirCarpeta(dir);
    return { carpeta: dir };
  });

  // ---------- Secciones ----------
  app.get('/api/asignaturas/:a/documentos/:d/secciones', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.listarSecciones(a, d);
  });
  app.post('/api/asignaturas/:a/documentos/:d/secciones', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.crearSeccion(a, d, String((req.body as { titulo?: string })?.titulo ?? ''));
  });
  app.put('/api/asignaturas/:a/documentos/:d/secciones/orden', async (req) => {
    const { a, d } = req.params as PD;
    return almacen.renumerar(a, d, (req.body as { orden: string[] }).orden);
  });
  app.get('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    return { contenido: await almacen.leerSeccion(a, d, s) };
  });
  app.put('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    const body = req.body as { contenido?: unknown } | null;
    if (!body || typeof body.contenido !== 'string') throw new ErrorUsuario('El contenido de la sección debe ser un texto.');
    await almacen.guardarSeccion(a, d, s, body.contenido);
    return { ok: true };
  });
  app.delete('/api/asignaturas/:a/documentos/:d/secciones/:s', async (req) => {
    const { a, d, s } = req.params as PS;
    await almacen.eliminarSeccion(a, d, s);
    return { ok: true };
  });

  // ---------- Fuentes (asignatura o documento) ----------
  const rutasFuentes = ['/api/asignaturas/:a/fuentes', '/api/asignaturas/:a/documentos/:d/fuentes'];
  for (const base of rutasFuentes) {
    app.get(base, async (req) => {
      const { a, d } = req.params as Partial<PD> & PA;
      return almacen.listarFuentes(a, d);
    });
    app.post(base, async (req) => {
      const { a, d } = req.params as Partial<PD> & PA;
      const guardados: string[] = [];
      for await (const parte of req.files()) {
        const destino = await almacen.rutaNuevaFuente(a, parte.filename, d);
        await saveUpload(parte.file, destino);
        guardados.push(path.basename(destino));
      }
      flujo.prepararFuentes(a, d).catch(() => {}); // extraer texto e indexar
      return { guardados };
    });
    app.delete(`${base}/:nombre`, async (req) => {
      const { a, d, nombre } = req.params as Partial<PD> & PA & { nombre: string };
      await almacen.eliminarFuente(a, nombre, d);
      flujo.prepararFuentes(a, d).catch(() => {});
      return { ok: true };
    });
    app.put(`${base}/:nombre`, async (req) => {
      const { a, d, nombre } = req.params as Partial<PD> & PA & { nombre: string };
      const body = req.body as { name?: unknown; expectedModified?: unknown } | null;
      if (typeof body?.name !== 'string' || typeof body?.expectedModified !== 'string') throw new ErrorUsuario('Indica el nombre y la versión de la fuente.');
      const source = await almacen.renameSource(a, nombre, body.name, body.expectedModified, d);
      await flujo.prepararFuentes(a, d);
      return source;
    });
  }

  // ---------- Agentes ----------
  app.get('/api/agentes', async () => Object.values(AGENTES));
  // Modelos de cada motor y, para cada agente, el modelo y esfuerzo que le da el perfil vigente
  // Requisitos para la pantalla de inicio: conexión, exportación y claves opcionales
  app.get('/api/requisitos', async () => {
    const conexion = await fetch('https://commons.wikimedia.org/w/api.php?action=query&format=json', { method: 'HEAD', signal: AbortSignal.timeout(6000) })
      .then((r) => r.ok || r.status < 500)
      .catch(() => false);
    return {
      conexion,
      exportacion: !!dirBin && fs.existsSync(rutaPandoc(dirBin)) && fs.existsSync(path.join(dirBin, process.platform === 'win32' ? 'typst.exe' : 'typst')),
      claves: { europeana: !!ajustes.claves?.europeana, smithsonian: !!ajustes.claves?.smithsonian },
    };
  });
  app.get('/api/modelos', async () => ({
    ...await modelosDisponibles(),
    predeterminados: { claude: preset('claude', ajustes.perfil), codex: preset('codex', ajustes.perfil), opencode: preset('opencode', ajustes.perfil) },
  }));
  // Un perfil de gasto rellena modelo y esfuerzo de todos los agentes en los dos motores
  app.post('/api/ajustes/perfil/:perfil', async (req) => {
    const perfil = (req.params as { perfil: string }).perfil as PerfilGasto;
    if (!(perfil in PERFILES)) throw new ErrorUsuario('Perfil no válido');
    ajustes = { ...ajustes, perfil, modelos: { claude: preset('claude', perfil), codex: preset('codex', perfil), opencode: ajustes.modelos?.opencode ?? preset('opencode', perfil) } };
    await guardarAjustes(op.archivoAjustes, ajustes);
    return ajustes;
  });
  app.get('/api/trabajos', async () => cola.listar());
  app.get('/api/trabajos/:id', async (req) => {
    const t = cola.obtener((req.params as { id: string }).id);
    if (!t) throw new ErrorUsuario('Trabajo no encontrado', 404);
    return t;
  });
  app.post('/api/trabajos/:id/cancelar', async (req) => {
    cola.cancelar((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/trabajos/:id/responder', async (req) => {
    const texto = String((req.body as { texto?: string })?.texto ?? '').trim();
    if (!texto) throw new ErrorUsuario('Escribe una respuesta');
    try {
      return cola.responder((req.params as { id: string }).id, texto);
    } catch (e) {
      throw new ErrorUsuario((e as Error).message);
    }
  });
  app.post('/api/trabajos/:id/reintentar', async (req) => {
    try {
      return await cola.reintentar((req.params as { id: string }).id);
    } catch (e) {
      throw new ErrorUsuario((e as Error).message);
    }
  });
  app.post('/api/trabajos/:id/esperar', async (req) => {
    cola.seguirEsperando((req.params as { id: string }).id);
    return { ok: true };
  });
  // Seguir sin esperar a que se renueve el límite de uso (p. ej. tras ampliar el plan)
  app.post('/api/cola/reanudar', async () => {
    cola.reanudarCola();
    return cola.uso;
  });
  app.post('/api/cola/guardar', async () => {
    cola.pausarTodo();
    await Promise.all([cola.flush(), contador.flush()]);
    return { ok: true };
  });
  app.post('/api/trabajos/limpiar', async () => {
    const removedIds = cola.limpiar();
    difundir({ tipo: 'trabajos-eliminados', ids: removedIds });
    return cola.listar();
  });

  app.post('/api/trabajos', async (req) => {
    const b = req.body as { motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string; herramientas?: HerramientasChat; seleccionTexto?: SeleccionTexto; ambito?: AmbitoChat };
    return flujo.chat(b.asignatura, b.documento, b.tarea ?? '', b.motor, b.seccion, b.herramientas, b.seleccionTexto, b.ambito);
  });

  app.get('/api/uso', async () => cola.uso);
  app.get('/api/tokens', async () => contador.leer());
  // Imágenes con licencia libre de museos, bibliotecas y archivos
  app.get('/api/imagenes-web/miniatura', async (req, reply) => {
    try {
      const m = await miniatura(String((req.query as { url?: string }).url ?? ''));
      reply.header('Content-Type', m.tipo).header('Cache-Control', 'max-age=86400');
      return m.datos;
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  app.get('/api/imagenes-web', async (req) => {
    const { q, local } = req.query as { q?: string; local?: string };
    if (!q?.trim()) throw new ErrorUsuario('Escribe qué buscar');
    return buscarImagenes(q, { consultaLocal: local, claves: ajustes.claves });
  });
  // Pictograma de ARASAAC de una palabra, para los bloques ```pictogramas
  app.get('/api/arasaac', async (req, reply) => {
    const { palabra, idioma } = req.query as { palabra?: string; idioma?: string };
    try {
      const png = await arasaac.pictograma(String(palabra ?? ''), String(idioma ?? 'es'));
      reply.header('Content-Type', 'image/png').header('Cache-Control', 'max-age=604800');
      return png;
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  // Fronteras históricas de un año para los bloques ```mapa (se descargan la primera vez)
  app.get('/api/mapas/fronteras/:anio', async (req, reply) => {
    try {
      const datos = await fronteras.geojson(Number((req.params as { anio: string }).anio));
      reply.header('Content-Type', 'application/json').header('Cache-Control', 'max-age=604800');
      return datos;
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 502);
    }
  });
  // Estructura de una molécula (nombre o SMILES) para los bloques ```molecula
  app.get('/api/molecula', async (req) => {
    try {
      return await moleculas.resolver(String((req.query as { q?: string }).q ?? ''));
    } catch (e) {
      throw new ErrorUsuario((e as Error).message, 404);
    }
  });
  app.delete('/api/tokens', async () => {
    contador.reiniciar();
    const c = contador.leer();
    difundir({ tipo: 'tokens', contador: c });
    return c;
  });

  // ---------- Flujo de trabajo del documento ----------
  const D = '/api/asignaturas/:a/documentos/:d';
  type Cuerpo = { indicaciones?: string; archivos?: string[]; tipos?: TipoRevision[]; ids?: string[] };
  const params = (req: FastifyRequest) => req.params as PD;
  const cuerpo = (req: FastifyRequest) => (req.body ?? {}) as Cuerpo;

  app.get(`${D}/flujo`, async (req) => flujo.estado(params(req).a, params(req).d));
  app.post(`${D}/flujo/investigar`, async (req) =>
    flujo.investigar(params(req).a, params(req).d, cuerpo(req).indicaciones, !!(req.body as { soloPreguntas?: boolean })?.soloPreguntas),
  );
  app.post(`${D}/flujo/preguntas`, async (req) =>
    flujo.anadirPregunta(params(req).a, params(req).d, String((req.body as { texto?: string })?.texto ?? '')),
  );
  app.delete(`${D}/flujo/preguntas/:id`, async (req) => {
    await flujo.eliminarPregunta(params(req).a, params(req).d, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.post(`${D}/flujo/indice`, async (req) => {
    const b = (req.body ?? {}) as { indicaciones?: string; profundidad?: number; soloApartados?: boolean };
    return flujo.proponerIndice(params(req).a, params(req).d, b.indicaciones, b.profundidad, !!b.soloApartados);
  });
  app.put(`${D}/flujo/indice`, async (req) => flujo.guardarIndice(params(req).a, params(req).d, req.body as Indice));
  app.post(`${D}/flujo/indice/aprobar`, async (req) => flujo.aprobarIndice(params(req).a, params(req).d));
  app.post(`${D}/flujo/redactar`, async (req) =>
    flujo.redactar(params(req).a, params(req).d, cuerpo(req).archivos ?? [], cuerpo(req).indicaciones),
  );
  app.post(`${D}/flujo/revisar`, async (req) => {
    const tipos = (cuerpo(req).tipos ?? []).filter((t) => ['estilo', 'calidad', 'fuentes', 'curriculo'].includes(t));
    if (!tipos.length) throw new ErrorUsuario('Elige al menos un tipo de revisión');
    return flujo.revisar(params(req).a, params(req).d, tipos, cuerpo(req).archivos, cuerpo(req).indicaciones);
  });
  app.post(`${D}/flujo/sugerencias/:decision`, async (req) => {
    const { decision } = req.params as { decision: string };
    if (decision !== 'aceptar' && decision !== 'rechazar') throw new ErrorUsuario('Decisión no válida');
    const b = req.body as { ids: string[]; propuesta?: string };
    return flujo.decidirSugerencias(params(req).a, params(req).d, b.ids ?? [], decision, b.propuesta);
  });
  app.delete(`${D}/flujo/sugerencias`, async (req) => {
    await flujo.limpiarSugerencias(params(req).a, params(req).d);
    return { ok: true };
  });
  app.post(`${D}/flujo/visuales`, async (req) =>
    flujo.proponerVisuales(params(req).a, params(req).d, cuerpo(req).archivos, cuerpo(req).indicaciones, (req.body as { mezcla?: MezclaVisuales })?.mezcla),
  );
  app.put(`${D}/flujo/visuales/:id`, async (req) =>
    flujo.editarPropuesta(params(req).a, params(req).d, (req.params as { id: string }).id, req.body as Partial<PropuestaVisual>),
  );
  app.post(`${D}/flujo/visuales/:id/generar`, async (req) =>
    flujo.generarVisual(params(req).a, params(req).d, (req.params as { id: string }).id, cuerpo(req).indicaciones),
  );
  app.post(`${D}/flujo/visuales/:id/aprobar`, async (req) =>
    flujo.approveVisual(params(req).a, params(req).d, (req.params as { id: string }).id),
  );
  app.delete(`${D}/flujo/visuales`, async (req) => {
    await flujo.limpiarVisuales(params(req).a, params(req).d);
    return { ok: true };
  });
  app.get(`${D}/pies`, async (req) => flujo.sinPie(params(req).a, params(req).d));
  app.post(`${D}/imagenes-web`, async (req) => {
    const b = req.body as { resultado: ResultadoImagen; seccion?: string; pie?: string };
    return flujo.guardarImagenWeb(params(req).a, params(req).d, b.resultado, b.seccion, b.pie);
  });
  app.get(`${D}/imagenes-faltan`, async (req) => flujo.imagenesQueFaltan(params(req).a, params(req).d));
  app.post(`${D}/imagenes-faltan`, async (req) => flujo.repararImagenes(params(req).a, params(req).d));
  app.post(`${D}/pies`, async (req) => flujo.anadirPies(params(req).a, params(req).d));
  // Bloques de actividades de autoevaluación
  app.post(`${D}/actividades`, async (req) => flujo.generarActividad(params(req).a, params(req).d, req.body as Partial<OpcionesActividad>));
  app.post(`${D}/actividades/:id/rehacer`, async (req) =>
    flujo.generarActividad(params(req).a, params(req).d, req.body as Partial<OpcionesActividad>, (req.params as { id: string }).id),
  );
  app.put(`${D}/actividades/:id`, async (req) =>
    flujo.editarActividad(params(req).a, params(req).d, (req.params as { id: string }).id, req.body as { incluir?: boolean; titulo?: string }),
  );
  app.delete(`${D}/actividades/:id`, async (req) => flujo.eliminarActividad(params(req).a, params(req).d, (req.params as { id: string }).id));


  // ---------- Importar apuntes existentes, diagnóstico e historial de las secciones ----------
  app.post('/api/asignaturas/:a/importar', async (req) => {
    const { a } = req.params as PA;
    const campos: Record<string, string> = {};
    let archivo: { ruta: string; nombre: string } | undefined;
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'apuntes-subida-'));
    try {
      for await (const parte of req.parts()) {
        if (parte.type === 'file') {
          if (archivo) throw new ErrorUsuario('Sube un solo archivo de apuntes por petición');
          const ruta = path.join(tmp, path.basename(parte.filename) || 'apuntes');
          await saveUpload(parte.file, ruta);
          archivo = { ruta, nombre: path.basename(parte.filename) };
        } else campos[parte.fieldname] = String(parte.value ?? '');
      }
      if (!archivo) throw new ErrorUsuario('Falta el archivo de los apuntes');
      return await flujo.importar(a, archivo, {
        titulo: campos.titulo,
        objetivo: campos.objetivo,
        destinatarios: campos.destinatarios,
        modo: campos.modo as ModoMejora,
        estiloOriginal: campos.estiloOriginal === 'true',
        diagnosticar: campos.diagnosticar !== 'false',
        importOnly: campos.importOnly === 'true',
      });
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
  app.post(`${D}/flujo/diagnostico`, async (req) => flujo.diagnosticar(params(req).a, params(req).d, cuerpo(req).indicaciones));
  // Abre el archivo original de unos apuntes importados con el programa del sistema
  app.post(`${D}/original/abrir`, async (req) => {
    const documento = await almacen.obtenerDocumento(params(req).a, params(req).d);
    const ruta = documento.importado && path.join(almacen.dirDocumento(params(req).a, params(req).d), 'original', path.basename(documento.importado.archivo));
    if (!ruta || !fs.existsSync(ruta)) throw new ErrorUsuario('No se encuentra el archivo original', 404);
    abrirArchivo(ruta);
    return { ok: true };
  });
  app.post(`${D}/flujo/modo`, async (req) => flujo.cambiarModo(params(req).a, params(req).d, (req.body as { modo: ModoMejora }).modo));
  app.get(`${D}/secciones/:s/historial`, async (req) => {
    const { a, d, s } = req.params as PS;
    return historial.listar(almacen.dirDocumento(a, d), s);
  });
  app.get(`${D}/secciones/:s/historial/:id`, async (req) => {
    const { a, d, s, id } = req.params as PS & { id: string };
    return { contenido: await historial.leer(almacen.dirDocumento(a, d), s, id).catch(() => { throw new ErrorUsuario('Esa versión ya no existe', 404); }) };
  });
  app.post(`${D}/secciones/:s/historial/:id/restaurar`, async (req) => {
    const { a, d, s, id } = req.params as PS & { id: string };
    const dirDoc = almacen.dirDocumento(a, d);
    const antigua = await historial.leer(dirDoc, s, id).catch(() => { throw new ErrorUsuario('Esa versión ya no existe', 404); });
    // El texto actual se guarda antes, para poder deshacer la restauración
    const actual = await almacen.leerSeccion(a, d, s).catch(() => '');
    if (actual.trim()) await historial.guardar(dirDoc, s, actual);
    await almacen.guardarSeccion(a, d, s, antigua);
    return { ok: true };
  });

  // Índice de las fuentes (RAG): estado y búsqueda para el usuario
  for (const base of ['/api/asignaturas/:a/fuentes-indice', '/api/asignaturas/:a/documentos/:d/fuentes-indice']) {
    type P = { a: string; d?: string };
    app.get(base, async (req) => {
      const { a, d } = req.params as P;
      await flujo.prepararFuentes(a, d);
      return indexar(almacen.dirFuentes(a, d));
    });
    app.post(`${base}/buscar`, async (req) => {
      const { a, d } = req.params as P;
      const consulta = String((req.body as { consulta?: string })?.consulta ?? '');
      return buscarRag(flujo.carpetasFuentes(a, d), consulta, 10);
    });
  }

  // Buscador de fuentes (asignatura o documento)
  for (const base of ['/api/asignaturas/:a/busqueda-fuentes', '/api/asignaturas/:a/documentos/:d/busqueda-fuentes']) {
    type P = { a: string; d?: string; id?: string };
    app.get(base, async (req) => flujo.resultadosBusqueda((req.params as P).a, (req.params as P).d));
    app.post(base, async (req) => {
      const b = (req.body ?? {}) as { consulta?: string; tipo?: TipoBusqueda };
      return flujo.buscarFuentes((req.params as P).a, (req.params as P).d, String(b.consulta ?? ''), b.tipo);
    });
    app.delete(base, async (req) => {
      await flujo.limpiarBusqueda((req.params as P).a, (req.params as P).d);
      return { ok: true };
    });
    app.post(`${base}/:id/anadir`, async (req) => flujo.anadirFuente((req.params as P).a, (req.params as P).d, (req.params as P).id!));
    app.post(`${base}/:id/descartar`, async (req) => flujo.descartarResultado((req.params as P).a, (req.params as P).d, (req.params as P).id!));
  }

  // Glosario de la asignatura
  // Currículo oficial de la asignatura
  // ---------- Exámenes de la asignatura ----------
  type PE = PA & { id: string };
  type PP = PE & { p: string };
  const E = '/api/asignaturas/:a/examenes/:id';
  const pe = (req: FastifyRequest) => req.params as PE;
  app.get('/api/asignaturas/:a/examenes', async (req) => flujo.listarExamenes((req.params as PA).a));
  app.post('/api/asignaturas/:a/examenes', async (req) =>
    flujo.crearExamen((req.params as PA).a, (req.body ?? {}) as { titulo?: string; opciones?: Partial<OpcionesExamen> }),
  );
  app.get(E, async (req) => flujo.examen(pe(req).a, pe(req).id));
  app.put(E, async (req) => flujo.editarExamen(pe(req).a, pe(req).id, (req.body ?? {}) as { titulo?: string; opciones?: Partial<OpcionesExamen> }));
  app.delete(E, async (req) => flujo.eliminarExamen(pe(req).a, pe(req).id));
  app.post(`${E}/generar`, async (req) => flujo.generarExamen(pe(req).a, pe(req).id, (req.body as { opciones?: Partial<OpcionesExamen> } | undefined)?.opciones));
  app.post(`${E}/adaptations`, async (req) => flujo.adaptExam(pe(req).a, pe(req).id, req.body as ExamAdaptationRequest));
  app.post(`${E}/puntuacion`, async (req) => flujo.ajustarPuntuacion(pe(req).a, pe(req).id, (req.body as { total?: number } | undefined)?.total));
  app.post(`${E}/orden`, async (req) => flujo.ordenarPreguntasExamen(pe(req).a, pe(req).id, ((req.body as { ids?: string[] })?.ids ?? []).map(String)));
  // Preguntas: nueva (con IA), rehacer (con IA), editar y quitar
  app.post(`${E}/preguntas`, async (req) => {
    const b = (req.body ?? {}) as { tipo?: PreguntaExamen['tipo']; indicaciones?: string };
    return flujo.pedirPreguntaExamen(pe(req).a, pe(req).id, { tipo: b.tipo, indicaciones: b.indicaciones });
  });
  app.post(`${E}/preguntas/:p/rehacer`, async (req) => {
    const { a, id, p } = req.params as PP;
    return flujo.pedirPreguntaExamen(a, id, { preguntaId: p, indicaciones: (req.body as { indicaciones?: string } | undefined)?.indicaciones });
  });
  app.put(`${E}/preguntas/:p`, async (req) => {
    const { a, id, p } = req.params as PP;
    return flujo.editarPreguntaExamen(a, id, p, (req.body ?? {}) as Partial<PreguntaExamen>);
  });
  app.delete(`${E}/preguntas/:p`, async (req) => {
    const { a, id, p } = req.params as PP;
    return flujo.eliminarPreguntaExamen(a, id, p);
  });
  // Archivos propios del examen (apuntes, libros, exámenes anteriores… que no se han hecho con la app)
  app.get(`${E}/fuentes`, async (req) => flujo.fuentesExamen(pe(req).a, pe(req).id));
  app.post(`${E}/fuentes`, async (req) => {
    const { a, id } = pe(req);
    const guardados: string[] = [];
    for await (const parte of req.files()) {
      const destino = await flujo.rutaFuenteExamen(a, id, parte.filename);
      await saveUpload(parte.file, destino);
      guardados.push(path.basename(destino));
    }
    await flujo.prepararFuentesExamen(a, id).catch(() => {});
    return { guardados };
  });
  app.delete(`${E}/fuentes/:nombre`, async (req) => flujo.eliminarFuenteExamen(pe(req).a, pe(req).id, (req.params as { nombre: string }).nombre));
  // Exportación: examen, solucionario y rúbrica (PDF, Word o LibreOffice) y Moodle
  app.get(`${E}/exportados`, async (req) => listarExportadosExamen(almacen, pe(req).a, pe(req).id));
  app.post(`${E}/exportar`, async (req) => {
    const formato = (req.body as { formato?: string } | undefined)?.formato as FormatoExamen;
    if (!['pdf', 'docx', 'odt'].includes(formato)) throw new ErrorUsuario('Formato no válido');
    if (!dirBin) throw new ErrorUsuario('La exportación no está disponible en este modo');
    return exportarExamen(almacen, dirBin, pe(req).a, await flujo.examen(pe(req).a, pe(req).id), formato);
  });
  app.post(`${E}/moodle`, async (req) => exportarExamenMoodle(almacen, pe(req).a, await flujo.examen(pe(req).a, pe(req).id)));
  app.post(`${E}/exportados/:nombre/abrir`, async (req) => {
    const ruta = rutaExportadoExamen(almacen, pe(req).a, pe(req).id, (req.params as { nombre: string }).nombre);
    if (!fs.existsSync(ruta)) throw new ErrorUsuario('El archivo ya no existe', 404);
    abrirArchivo(ruta);
    return { ok: true };
  });
  app.post(`${E}/carpeta`, async (req) => {
    const { a, id } = pe(req);
    await flujo.examen(a, id);
    const dir = path.join(almacen.dirExamen(a, id), 'exportados');
    await fsp.mkdir(dir, { recursive: true });
    abrirCarpeta(dir);
    return { ok: true };
  });

  app.post('/api/asignaturas/:a/curriculo/buscar', async (req) => {
    const input = (req.body ?? {}) as { indicaciones?: string; profile?: CurriculumProfile };
    return flujo.buscarCurriculo((req.params as PA).a, input.indicaciones, input);
  });
  // Structured drafts use optimistic revisions; activation keeps immutable version snapshots.
  const curriculumRoute = '/api/asignaturas/:a/curriculo';
  const programmesRoute = '/api/asignaturas/:a/programaciones';
  const programmeRoute = `${programmesRoute}/:p`;
  app.get(programmesRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    return flujo.programmeProjects(subject.id).list();
  });
  app.post(programmesRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    return flujo.programmeProjects(subject.id).create(req.body as CreateProgrammeRequest);
  });
  app.delete(programmeRoute, async (req) => flujo.deleteProgramme((req.params as PA).a, (req.params as { p: string }).p));
  app.get(programmeRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const project = await flujo.programmeProjects(subject.id).get((req.params as { p: string }).p);
    const store = await flujo.programmeStore(subject.id, project.id, parseProgrammePurpose((req.query as { purpose?: string }).purpose)), state = await store.read();
    const curricula = await almacen.curriculum(subject.id).read();
    const programme = state.draft ?? state.reviewed?.programme;
    const purpose = parseProgrammePurpose((req.query as { purpose?: string }).purpose);
    const context = await flujo.programmePlanningContext(subject.id, project.id, purpose);
    const research = await (await flujo.programmeProjects(subject.id).research(project.id, purpose)).read();
    const unitProposal = await (await flujo.programmeUnitHelpStore(subject.id, project.id, purpose)).read();
    return { state, project, unitProposal: unitProposal ? { ...unitProposal, applied: state.appliedJobs.includes(`unit-proposal:${unitProposal.jobId}`) } : undefined, curriculum: await store.curriculum(programme?.curriculumVersionId ?? project.curriculumVersionId), activeVersionId: curricula.activeVersionId, research, researchContextFingerprint: context.fingerprint };
  });
  app.put(programmeRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const input = (req.body ?? {}) as { programme: unknown; expectedRevision: number; confirmed?: unknown };
    return (await flujo.programmeStore(subject.id, (req.params as { p: string }).p, parseProgrammePurpose((req.query as { purpose?: string }).purpose))).save(input.programme, input.expectedRevision, { confirmed: input.confirmed });
  });
  app.post(`${programmeRoute}/generar`, async (req) => {
    const input = (req.body ?? {}) as { expectedRevision: number; instructions?: string };
    if (input.instructions !== undefined && (typeof input.instructions !== 'string' || input.instructions.length > 20000)) throw new ErrorUsuario('Indicaciones no válidas.');
    return flujo.generateProgramme((req.params as PA).a, (req.params as { p: string }).p, input.expectedRevision, input.instructions, parseProgrammePurpose((req.query as { purpose?: string }).purpose));
  });
  app.post(`${programmeRoute}/ayuda-unidades`, async (req) => {
    const input = (req.body ?? {}) as { expectedRevision: number; instructions?: string; unitId?: string };
    if ((input.instructions !== undefined && (typeof input.instructions !== 'string' || input.instructions.length > 20000)) || (input.unitId !== undefined && (typeof input.unitId !== 'string' || input.unitId.length > 80))) throw new ErrorUsuario('Indicaciones de ayuda no válidas.');
    return flujo.helpProgrammeUnits((req.params as PA).a, (req.params as { p: string }).p, input.expectedRevision, input.instructions, parseProgrammePurpose((req.query as { purpose?: string }).purpose), input.unitId);
  });
  app.post(`${programmeRoute}/ayuda-unidades/aplicar`, async (req) => {
    const input = (req.body ?? {}) as { jobId: string; expectedRevision: number };
    if (typeof input.jobId !== 'string' || input.jobId.length > 100) throw new ErrorUsuario('Propuesta no válida.');
    return flujo.applyProgrammeUnits((req.params as PA).a, (req.params as { p: string }).p, parseProgrammePurpose((req.query as { purpose?: string }).purpose), input.jobId, input.expectedRevision);
  });
  app.post(`${programmeRoute}/investigar`, async (req) => {
    return flujo.researchProgramme((req.params as PA).a, (req.params as { p: string }).p, parseProgrammePurpose((req.query as { purpose?: string }).purpose));
  });
  const downloadProgramme = async (req: FastifyRequest, reply: FastifyReply) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a), projectId = (req.params as { p: string }).p;
    const query = req.query as { purpose?: string; reviewed?: string; format?: string }, purpose = parseProgrammePurpose(query.purpose);
    const format = query.format ?? 'md';
    if (!Object.hasOwn(PROGRAMME_EXPORT_MIMES, format)) throw new ErrorUsuario('Formato de exportación no válido.');
    const store = await flujo.programmeStore(subject.id, projectId, purpose), state = await store.read();
    const reviewed = query.reviewed === 'true', input = req.body as { programme?: unknown } | undefined;
    let programme = reviewed ? state.reviewed?.programme : state.draft;
    const project = await flujo.programmeProjects(subject.id).get(projectId), curriculum = await store.curriculum(project.curriculumVersionId);
    if (!reviewed && req.method === 'POST') {
      programme = parseProgramme(input?.programme, curriculum);
      if (programme.purpose !== purpose) throw new ErrorUsuario('Esta programación pertenece a otra finalidad.');
    }
    if (!programme) throw new ErrorUsuario('No hay una programación guardada para exportar.');
    const report = reviewed ? undefined : await (await flujo.programmeProjects(subject.id).research(projectId, purpose)).read();
    const research = reviewed ? state.reviewed?.research : report?.revision === programme.researchRevision ? report?.result : undefined;
    const exported = await exportProgramme(almacen, subject.id, programme, curriculum, format as ProgrammeExportFormat, { dirBin, reviewed, research });
    return reply.header('Content-Disposition', `attachment; filename="${exported.filename}"`).type(exported.mime).send(exported.content);
  };
  app.get(`${programmeRoute}/exportar`, downloadProgramme);
  app.post(`${programmeRoute}/exportar`, downloadProgramme);
  app.get(curriculumRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const store = almacen.curriculum(subject.id);
    return { state: await store.read(), suggestedProfile: suggestedCurriculumProfile(subject) };
  });
  app.put(curriculumRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const input = (req.body ?? {}) as { draft?: unknown; expectedRevision: number };
    return almacen.curriculum(subject.id).saveDraft(input.draft, input.expectedRevision);
  });
  app.post(`${curriculumRoute}/activar`, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const input = req.body as { expectedRevision: number; review?: { draft: unknown; confirmed: unknown } };
    return almacen.curriculum(subject.id).activate(input?.expectedRevision, input?.review);
  });
  app.delete(curriculumRoute, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    return almacen.curriculum(subject.id).discardDraft((req.body as { expectedRevision: number })?.expectedRevision);
  });
  app.post(`${curriculumRoute}/restaurar`, async (req) => {
    const subject = await almacen.obtenerAsignatura((req.params as PA).a);
    const input = (req.body ?? {}) as { versionId: string; expectedRevision: number };
    return almacen.curriculum(subject.id).restoreDraft(input.versionId, input.expectedRevision);
  });
  app.post('/api/asignaturas/:a/glosario/actualizar', async (req) => flujo.glosario((req.params as PA).a, cuerpo(req).indicaciones));
  app.get('/api/asignaturas/:a/glosario', async (req) => ({ contenido: await almacen.leerGlosario((req.params as PA).a) }));
  app.put('/api/asignaturas/:a/glosario', async (req) => {
    await almacen.guardarGlosario((req.params as PA).a, String((req.body as { contenido?: string }).contenido ?? ''));
    return { ok: true };
  });

  // Archivos editables de la raíz del documento (dossier de investigación)
  app.get(`${D}/archivo/:nombre`, async (req) => {
    const { nombre } = req.params as { nombre: string };
    if (!Almacen.ARCHIVOS_EDITABLES.includes(nombre)) throw new ErrorUsuario('Archivo no disponible', 404);
    return { contenido: await almacen.leerArchivoDoc(params(req).a, params(req).d, nombre) };
  });
  app.put(`${D}/archivo/:nombre`, async (req) => {
    const { nombre } = req.params as { nombre: string };
    await almacen.guardarArchivoDoc(params(req).a, params(req).d, nombre, String((req.body as { contenido?: string }).contenido ?? ''));
    return { ok: true };
  });

  // Recursos (imágenes)
  app.get(`${D}/recursos`, async (req) => almacen.listarRecursos(params(req).a, params(req).d));
  app.delete(`${D}/recursos/:nombre`, async (req) => {
    await almacen.eliminarRecurso(params(req).a, params(req).d, (req.params as { nombre: string }).nombre);
    return { ok: true };
  });

  // Exportación
  app.post(`${D}/version`, async (req) => {
    const b = req.body as { tipo?: TipoVersion; indicaciones?: string };
    return flujo.crearVersion(params(req).a, params(req).d, b.tipo as TipoVersion, b.indicaciones);
  });
  app.post(`${D}/actividades/:id/moodle`, async (req) => flujo.exportarMoodle(params(req).a, params(req).d, (req.params as { id: string }).id));
  app.post(`${D}/exportar`, async (req) => {
    const b = req.body as { opciones: OpcionesExportacion; diagramas?: Record<string, string> };
    if (!['docx', 'odt', 'pdf', 'md'].includes(b?.opciones?.formato)) throw new ErrorUsuario('Formato no válido');
    if (!dirBin) throw new ErrorUsuario('La exportación no está disponible en este modo');
    return exportar(almacen, dirBin, params(req).a, params(req).d, b.opciones, b.diagramas ?? {});
  });
  app.post(`${D}/exportados/:nombre/abrir`, async (req) => {
    const ruta = almacen.rutaExportado(params(req).a, params(req).d, (req.params as { nombre: string }).nombre);
    if (!fs.existsSync(ruta)) throw new ErrorUsuario('El archivo ya no existe', 404);
    abrirArchivo(ruta);
    return { ok: true };
  });

  // Plantillas de Word / LibreOffice de la asignatura
  app.get('/api/asignaturas/:a/plantillas', async (req) => almacen.plantillas((req.params as PA).a));
  app.post('/api/asignaturas/:a/plantillas', async (req) => {
    const { a } = req.params as PA;
    for await (const parte of req.files()) {
      const ext = path.extname(parte.filename).toLowerCase();
      if (ext !== '.docx' && ext !== '.odt') {
        parte.file.resume();
        throw new ErrorUsuario('La plantilla debe ser un .docx o un .odt');
      }
      await saveUpload(parte.file, almacen.rutaPlantilla(a, ext.slice(1) as 'docx' | 'odt'), true);
    }
    return almacen.plantillas(a);
  });
  // Documento de base con todos los elementos, para crear la plantilla a partir de él
  app.get('/api/asignaturas/:a/plantillas/base/:formato', async (req, reply) => {
    const { a, formato } = req.params as PA & { formato: string };
    if (formato !== 'docx' && formato !== 'odt') throw new ErrorUsuario('Formato no válido');
    if (!dirBin) throw new ErrorUsuario('No está disponible en este modo');
    const datos = await plantillaBase(almacen, dirBin, a, formato);
    const nombre = `plantilla-base-${a}.${formato}`;
    reply
      .header('Content-Type', formato === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.oasis.opendocument.text')
      .header('Content-Disposition', `attachment; filename="${nombre}"`);
    return datos;
  });
  app.delete('/api/asignaturas/:a/plantillas/:formato', async (req) => {
    const { a, formato } = req.params as PA & { formato: string };
    if (formato !== 'docx' && formato !== 'odt') throw new ErrorUsuario('Formato no válido');
    await fsp.rm(almacen.rutaPlantilla(a, formato), { force: true });
    return almacen.plantillas(a);
  });

  // ---------- Archivos de datos (imágenes de los apuntes) ----------
  app.get('/datos/*', async (req: FastifyRequest, rep: FastifyReply) => {
    const rel = (req.params as { '*': string })['*'];
    const abs = path.resolve(almacen.raiz, rel);
    if (!abs.startsWith(path.resolve(almacen.raiz) + path.sep)) return rep.code(403).send();
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return rep.code(404).send();
    const realRoot = await fsp.realpath(almacen.raiz);
    const realFile = await fsp.realpath(abs);
    const relativeFile = path.relative(realRoot, realFile);
    if (relativeFile.startsWith(`..${path.sep}`) || relativeFile === '..' || path.isAbsolute(relativeFile)) return rep.code(403).send();
    return rep
      .type(tipoMime(abs))
      .header('Cache-Control', 'no-cache')
      // Un SVG descargado de internet no debe poder ejecutar scripts en la app
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
      .send(fs.createReadStream(realFile));
  });

  // ---------- Interfaz ----------
  if (op.dirEstatico && fs.existsSync(op.dirEstatico)) {
    await app.register(fastifyStatic, { root: op.dirEstatico, wildcard: false });
    app.setNotFoundHandler((req, rep) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return rep.code(404).send({ error: 'No encontrado' });
      return rep.sendFile('index.html');
    });
  }

  const usageController = new AbortController();
  let usagePending = false;
  const refreshCodexUsage = async () => {
    if (usagePending || usageController.signal.aborted) return;
    usagePending = true;
    try {
      const codex = await (op.codexUsageReader ?? readCodexUsage)({ signal: usageController.signal });
      cola.uso = { ...cola.uso, codex, actualizado: Date.now() };
    } catch {
      cola.uso = { ...cola.uso, codex: { windows: [], updatedAt: Date.now(), unavailable: true }, actualizado: Date.now() };
    } finally {
      usagePending = false;
    }
    if (!usageController.signal.aborted) difundir({ tipo: 'uso', uso: cola.uso });
  };
  let usageTimer: NodeJS.Timeout | undefined;
  app.addHook('onClose', async () => {
    clearInterval(usageTimer);
    usageController.abort();
    await releaseInstance();
  });
  const direccion = await app.listen({ port: op.puerto ?? 0, host: op.host ?? '127.0.0.1' });
  usageTimer = setInterval(() => { void refreshCodexUsage(); }, 60000);
  usageTimer.unref();
  void refreshCodexUsage();
  return {
    url: direccion.replace('[::1]', 'localhost'),
    avisarActualizacion(estado: 'disponible' | 'descargada', version: string) {
      actualizacion = { estado, version };
      difundir({ tipo: 'actualizacion', estado, version });
    },
    /** Cierra los agentes en marcha; se relanzarán al volver a abrir la app. */
    async cerrar() {
      cola.pausarTodo();
      vigilante?.close();
      await Promise.all([cola.flush(), contador.flush()]);
      await app.close();
    },
  };
  } catch (error) { await releaseInstance(); throw error; }
}

function tipoMime(archivo: string): string {
  const ext = path.extname(archivo).toLowerCase();
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.md': 'text/markdown; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    }[ext] ?? 'application/octet-stream'
  );
}
