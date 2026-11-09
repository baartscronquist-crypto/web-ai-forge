import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { forgemark } from './forgemark-cli.mjs';
import { saveIfUnchanged, snapshot } from './review-document.mjs';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    author: { type: 'string', default: 'Web reviewer (manual import)' },
  } });
  const [input, thread, response, replacement, anchor] = positionals;
  if (!/\.(?:md|markdown)$/i.test(input ?? '') || !/^[1-9]\d*$/.test(thread ?? '') || !response || ![3, 5].includes(positionals.length)) {
    throw new Error('Usage: node src/review-import.mjs <file.md> <thread-id> <reply.txt> [replacement.txt anchor.txt] [--author <name>]');
  }
  if (!values.author.trim()) throw new Error('Give the reviewer a source name.');
  const file = resolve(input);
  const original = await snapshot(file);
  if (original.text === null) throw new Error('The selected Markdown file does not exist.');
  const responseFile = resolve(response);
  if (!(await snapshot(responseFile)).text?.trim()) throw new Error('Give a nonempty reviewer reply.');
  const temp = `${file}.${randomUUID()}.forge-import.md`;
  try {
    await writeFile(temp, original.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const reply = await forgemark(['reply', temp, thread, '--author', values.author, '--body-file', responseFile]);
    let suggestion = '';
    if (replacement !== undefined) {
      const from = (await snapshot(resolve(anchor))).text?.trim();
      const to = (await snapshot(resolve(replacement))).text?.replace(/\r?\n$/, '');
      if (!from || !to?.trim()) throw new Error('Give a nonempty source anchor and replacement.');
      suggestion = await forgemark(['comment', temp, '--anchor', from, '--suggest', to, '--thread', thread,
        '--author', 'Web AI Forge', '--body', 'Review the imported wording before applying it.']);
    }
    await forgemark(['lint', temp, '--strict']);
    const imported = await snapshot(temp);
    if (!await saveIfUnchanged(file, imported.text, original.hash)) {
      throw new Error('The file changed during import. Reload it and try again.');
    }
    process.stdout.write(reply + suggestion);
  } finally {
    await rm(temp, { force: true });
  }
}

main().catch((error) => {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
});
