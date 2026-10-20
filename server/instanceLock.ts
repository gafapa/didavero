import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';

/** The OS releases this exclusive loopback lease on process exit; stale or reused PIDs are irrelevant. */
export async function acquireInstanceLock(directory: string): Promise<() => Promise<void>> {
  await fs.mkdir(directory, { recursive: true });
  const resolved = await fs.realpath(directory), identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const port = 12000 + createHash('sha256').update(path.normalize(identity)).digest().readUInt32BE(0) % 16000;
  const lease = net.createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    lease.once('error', error => reject(new Error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Didavero ya está abierta o el puerto local de bloqueo ${port} está ocupado. Cierra la otra instancia antes de continuar.` : 'No se ha podido reservar el bloqueo local.', { cause: error })));
    lease.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  lease.unref();
  return () => new Promise<void>((resolve, reject) => { if (!lease.listening) resolve(); else lease.close(error => error ? reject(error) : resolve()); });
}
