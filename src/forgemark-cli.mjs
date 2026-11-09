import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

export const cli = resolve(import.meta.dirname, '../runtime/forgemark/assets/forgemark-skill/scripts/forgemark.mjs');
const execute = promisify(execFile);

export async function forgemark(args) {
  const { stdout } = await execute(process.execPath, [cli, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
