import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = join(root, 'demo', 'sample.md');
const reviewedSample = join(root, 'demo', 'reviewed-sample.md');
const cli = join(root, 'runtime', 'forgemark', 'assets', 'forgemark-skill', 'scripts', 'forgemark.mjs');

function forgemark(command, document, ...args) {
  return execFileSync(process.execPath, [cli, command, document, ...args], { encoding: 'utf8' });
}

test('the fictional demo includes an editable formula and a pending, linked suggestion', async () => {
  const original = await readFile(sample, 'utf8');
  assert.match(original, /fictional trial/);
  assert.match(original, /\$\$\r?\nq_i = \\frac\{V_i\}\{\\Delta t\}\r?\n\$\$/);
  forgemark('lint', sample, '--strict');
  forgemark('lint', reviewedSample, '--strict');

  const { comments } = JSON.parse(forgemark('list', reviewedSample, '--json'));
  const suggestion = comments.find((entry) => entry.suggested_edit);
  assert.ok(suggestion, 'The reviewed demo has a suggested edit.');
  assert.equal(suggestion.review_status, undefined);
  assert.ok(original.includes(suggestion.suggested_edit.from), 'The suggestion targets the original text.');
  assert.ok(suggestion.suggested_edit.to.includes('10-minute watering period'));
  const parent = comments.find((entry) => entry.id === suggestion.review_parent_id);
  assert.ok(parent?.replies?.some((reply) => /example|sample|fixture/i.test(`${reply.author} ${reply.body}`)),
    'The original thread retains attributed sample feedback.');
});

test('adding a comment and importing a reviewer reply leaves the draft body intact', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'web-ai-forge-test-'));
  const file = join(temp, 'sample.md');
  const replyFile = join(temp, 'reply.txt');
  const replacementFile = join(temp, 'replacement.txt');
  const anchorFile = join(temp, 'anchor.txt');
  try {
    const original = await readFile(sample, 'utf8');
    await writeFile(file, original);
    forgemark('comment', file, '--anchor', 'Volumes are reported in milliliters.',
      '--author', 'Demo author', '--body', 'Please polish the preceding sentence.');
    const [thread] = JSON.parse(forgemark('list', file, '--json')).comments;
    const { comments: reviewed } = JSON.parse(forgemark('list', reviewedSample, '--json'));
    const proposed = reviewed.find((entry) => entry.suggested_edit).suggested_edit;
    const reply = 'Preserve the tray count and the watering interval.';
    await Promise.all([writeFile(replyFile, reply), writeFile(replacementFile, proposed.to), writeFile(anchorFile, proposed.from)]);
    execFileSync(process.execPath, [join(root, 'src', 'review-import.mjs'), file, String(thread.id),
      replyFile, replacementFile, anchorFile, '--author', 'Example Web reviewer'], { encoding: 'utf8' });
    const [updated, suggestion] = JSON.parse(forgemark('list', file, '--json')).comments;
    assert.equal(updated.replies[0].author, 'Example Web reviewer');
    assert.equal(updated.replies[0].body.trimEnd(), reply);
    assert.equal(suggestion.review_parent_id, thread.id);
    assert.equal(suggestion.review_status, undefined);
    assert.deepEqual(suggestion.suggested_edit, proposed);
    const annotated = await readFile(file, 'utf8');
    const body = annotated.split(/^<!-- forgemark-comments\s*$/m)[0]
      .replace(/<!-- \/?fmc:\d+ -->/g, '').trimEnd();
    assert.equal(body, original.trimEnd());
    forgemark('lint', file, '--strict');
  } finally {
    await Promise.all([file, replyFile, replacementFile, anchorFile].map((item) => rm(item, { force: true })));
    await rmdir(temp);
  }
});
