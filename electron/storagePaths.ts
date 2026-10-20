import path from 'node:path';

/** Prefer existing storage without moving files during a product rename. */
export function productStoragePaths(appData: string, documents: string, portableDirectory: string | undefined, exists: (filename: string) => boolean) {
  const legacyName = 'Apuntes IA';
  const portable = portableDirectory ? path.join(portableDirectory, exists(path.join(portableDirectory, `${legacyName} datos`)) ? `${legacyName} datos` : 'Didavero datos') : undefined;
  const userData = portable ? path.join(portable, '.electron') : path.join(appData, exists(path.join(appData, legacyName)) ? legacyName : 'Didavero');
  const data = portable ? path.join(portable, 'apuntes') : path.join(documents, exists(path.join(documents, legacyName)) ? legacyName : 'Didavero');
  return { portable, userData, data };
}
