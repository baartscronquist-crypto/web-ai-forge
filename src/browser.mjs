// Forgemark expects a Tauri file transport. The browser host maps only one
// explicitly selected Markdown file and its version history.
const historyPath = documentPath + '.forgemark-versions.json';
const endpoints = new Map([
  [documentPath, '/__demo/document'],
  [historyPath, '/__demo/history'],
]);
const snapshots = new Map();
const writes = new Map();
let opened = false;
let nextId = 0;

async function read(path) {
  const endpoint = endpoints.get(path);
  if (!endpoint) throw new Error('Only the selected document is available.');
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  snapshots.set(path, data.hash);
  return data.text;
}

Object.assign(window, {
  __FORGEMARK_DEMO__: true,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    plugins: {},
    transformCallback: () => ++nextId,
    unregisterCallback() {},
    convertFileSrc: () => '',
    async invoke(command, args, options) {
      switch (command) {
        case 'take_pending_files':
          if (opened) return [];
          opened = true;
          return [documentPath];
        case 'plugin:dialog|open': return [documentPath];
        case 'plugin:dialog|save': return null;
        case 'plugin:fs|read_text_file': {
          const content = await read(args.path);
          if (content === null) throw new Error('File not found.');
          return new TextEncoder().encode(content).buffer;
        }
        case 'plugin:fs|stat':
        case 'plugin:fs|lstat': {
          if (!endpoints.has(args.path) || (args.path === historyPath && snapshots.get(args.path) == null)) {
            throw new Error('File not found.');
          }
          return { isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null };
        }
        case 'plugin:fs|exists': return (await read(args.path)) !== null;
        case 'plugin:fs|write_text_file': {
          const target = decodeURIComponent(options?.headers?.path ?? '');
          const path = [historyPath, documentPath].find((p) => target.startsWith(p + '.') && target.endsWith('.forgemark-tmp'));
          if (!path) throw new Error('Only atomic saves are supported.');
          writes.set(target, { path, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(args), expected: snapshots.get(path) ?? null });
          return null;
        }
        case 'plugin:fs|rename': {
          const staged = writes.get(args.oldPath);
          if (!staged || staged.path !== args.newPath) throw new Error('Invalid save target.');
          const { text, expected } = staged;
          const response = await fetch(endpoints.get(staged.path), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, expected }),
          });
          if (!response.ok) throw new Error(await response.text());
          snapshots.set(staged.path, response.headers.get('X-File-Hash'));
          writes.delete(args.oldPath);
          return null;
        }
        case 'plugin:fs|remove': writes.delete(args.path); return null;
        case 'plugin:event|listen': return ++nextId;
        case 'plugin:event|unlisten':
        case 'plugin:event|emit':
        case 'set_recent_files':
          return null;
        default:
          if (command.startsWith('plugin:window|') || command.startsWith('plugin:webview|')) return null;
          throw new Error('Unavailable in the local browser workspace: ' + command);
      }
    },
  },
});
localStorage.setItem('forgemark.firstRunDone', 'true');
localStorage.setItem('forgemark.checkForUpdates', 'off');
if (!localStorage.getItem('forgemark.author')) localStorage.setItem('forgemark.author', 'Local reviewer');
