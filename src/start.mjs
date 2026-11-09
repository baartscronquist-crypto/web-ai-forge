import { constants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hash, MAX_DOCUMENT_BYTES, saveIfUnchanged, snapshot } from './review-document.mjs';

const workspace = resolve(import.meta.dirname, '..');
const upstream = resolve(workspace, 'runtime/forgemark');
const hostname = '127.0.0.1';

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_DOCUMENT_BYTES * 6 + 256) throw new Error('Request too large.');
    parts.push(part);
  }
  const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (typeof data?.text !== 'string' || !(data.expected === null || (typeof data.expected === 'string' && /^[0-9a-f]{64}$/.test(data.expected)))) {
    throw new Error('Invalid document save.');
  }
  if (Buffer.byteLength(data.text) > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the size limit.');
  return data;
}

async function demoFile() {
  const file = resolve(workspace, 'runtime/demo/sample.md');
  await mkdir(dirname(file), { recursive: true });
  try {
    await copyFile(resolve(workspace, 'demo/reviewed-sample.md'), file, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await copyFile(resolve(workspace, 'demo/sample.md'), file, constants.COPYFILE_EXCL).catch((copyError) => {
        if (copyError.code !== 'EEXIST') throw copyError;
      });
    } else if (error.code !== 'EEXIST') throw error;
  }
  return file;
}

async function reviewHost(file, origin) {
  const browserPath = '/__demo/browser.js';
  const bridge = `const documentPath = ${JSON.stringify('/' + basename(file))};\n` +
    await readFile(resolve(import.meta.dirname, 'browser.mjs'), 'utf8');
  const files = new Map([
    ['/__demo/document', file],
    ['/__demo/history', file + '.forgemark-versions.json'],
  ]);
  let writes = Promise.resolve();
  return {
    name: 'web-ai-forge-local-review',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'script', attrs: { type: 'module', src: browserPath }, injectTo: 'head-prepend' }],
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (`http://${req.headers.host}` !== origin) return res.writeHead(403).end();
        const pathname = new URL(req.url ?? '/', origin).pathname;
        if (!pathname.startsWith('/__demo/')) return next();
        if (req.headers['sec-fetch-site'] === 'cross-site') return res.writeHead(403).end();
        const finish = (status, data, type = 'text/plain; charset=utf-8') => {
          res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(data);
        };
        if (pathname === browserPath && req.method === 'GET') return finish(200, bridge, 'text/javascript; charset=utf-8');
        const target = files.get(pathname);
        if (!target) return res.writeHead(404).end();
        const handle = async () => {
          if (req.method === 'GET') {
            const { text, hash } = await snapshot(target);
            return finish(200, JSON.stringify({ text, hash }), 'application/json; charset=utf-8');
          }
          if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
            return res.writeHead(403).end();
          }
          let body;
          try {
            body = await readBody(req);
          } catch {
            return finish(400, 'Invalid save request.');
          }
          const write = writes.then(() => saveIfUnchanged(target, body.text, body.expected));
          writes = write.catch(() => {});
          if (!await write) return finish(409, 'The file changed on disk. Reload and review the changes before saving.');
          res.writeHead(204, { 'X-File-Hash': hash(body.text), 'Cache-Control': 'no-store' }).end();
        };
        void handle().catch(() => finish(500, 'Could not access the selected file.'));
      });
    },
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    demo: { type: 'boolean' },
    document: { type: 'string' },
    port: { type: 'string', default: '1430' },
  } });
  if (values.demo && values.document !== undefined) throw new Error('Choose --demo or --document, not both.');
  if (values.document !== undefined && !/\.(?:md|markdown)$/i.test(values.document)) throw new Error('Select a Markdown file.');
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535.');
  const modules = resolve(upstream, 'node_modules');
  let vite;
  let react;
  try {
    vite = await import(pathToFileURL(resolve(modules, 'vite/dist/node/index.js')));
    react = await import(pathToFileURL(resolve(modules, '@vitejs/plugin-react/dist/index.js')));
  } catch (error) {
    throw new Error('Install the pinned Forgemark runtime and dependencies first. See INSTALL_WITH_AI.md.', { cause: error });
  }
  const file = values.document === undefined ? await demoFile() : resolve(values.document);
  if ((await snapshot(file)).text === null) throw new Error('The selected Markdown file does not exist.');
  const origin = `http://${hostname}:${port}`;
  const server = await vite.createServer({
    root: upstream,
    configFile: false,
    cacheDir: resolve(workspace, 'runtime/vite-cache'),
    plugins: [react.default(), await reviewHost(file, origin)],
    assetsInclude: ['**/*.skill', '**/*.zip'],
    server: {
      host: hostname,
      port,
      strictPort: true,
      cors: false,
      fs: { allow: [upstream] },
      watch: { ignored: ['**/src-tauri/**'] },
    },
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  console.log(`Web AI Forge is ready at ${origin}/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
