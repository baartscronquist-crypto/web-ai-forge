import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const hash = (data) => createHash('sha256').update(data).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export async function snapshot(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { text: null, hash: null, mode: 0o600 };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular file.');
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the size limit.');
  const bytes = await readFile(path);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the size limit.');
  return { text: utf8.decode(bytes), hash: hash(bytes), mode: info.mode & 0o777 };
}

export async function saveIfUnchanged(path, text, expected) {
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the size limit.');
  const current = await snapshot(path);
  if (current.hash !== expected) return false;
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx', mode: current.mode });
    if ((await snapshot(path)).hash !== expected) return false;
    await rename(temp, path);
    return true;
  } finally {
    await rm(temp, { force: true });
  }
}
