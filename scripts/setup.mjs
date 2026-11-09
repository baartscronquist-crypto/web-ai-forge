import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, 'runtime');
const target = join(runtime, 'forgemark');
const patchPath = join(root, 'upstream', 'forgemark.patch');
const stampName = '.web-ai-forge-install.json';

function run(program, args, cwd, capture = false) {
  return execFileSync(program, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

async function statIfPresent(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function verifyArchive(archive, expected) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  if (digest.digest('hex') !== expected) throw new Error('The Forgemark archive does not match the locked SHA-256.');
}

async function removeStage(stage, parent) {
  const resolved = await realpath(stage);
  if (dirname(resolved) !== parent || !resolved.startsWith(join(parent, 'forgemark-setup-'))) {
    throw new Error('The setup staging directory is outside the expected runtime directory.');
  }
  await rm(resolved, { recursive: true, force: true });
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 or later is required.');

  const { values: { archive, offline } } = parseArgs({
    options: { archive: { type: 'string' }, offline: { type: 'boolean' } },
  });
  if (offline && !archive) throw new Error('Offline setup requires --archive with a copy of the locked upstream archive.');
  if (!process.env.npm_execpath) throw new Error('Run setup with npm run setup.');

  const manifest = JSON.parse(await readFile(join(root, 'upstream', 'versions.json'), 'utf8'));
  const { repository, commit, sha256, version } = manifest.forgemark;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository) ||
      !/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('The Forgemark upstream lock must name an HTTPS GitHub repository, a full commit and an archive SHA-256.');
  }
  const patchSha256 = createHash('sha256').update(await readFile(patchPath)).digest('hex');
  const stamp = JSON.stringify({ schema: 1, repository, commit, patchSha256 });

  await mkdir(runtime, { recursive: true });
  if (!(await lstat(runtime)).isDirectory()) throw new Error('The runtime path must be a local directory.');
  const existing = await statIfPresent(target);
  if (existing) {
    if (existing.isDirectory()) {
      const installed = await readFile(join(target, stampName), 'utf8').catch(() => '');
      const vite = await statIfPresent(join(target, 'node_modules', 'vite', 'package.json'));
      if (installed.trim() === stamp && vite?.isFile()) {
        console.log('The pinned Forgemark runtime is already installed. Run npm run demo.');
        return;
      }
    }
    throw new Error('runtime/forgemark already exists with a different or incomplete install. Move it aside, then run setup again.');
  }

  const runtimePath = await realpath(runtime);
  const stage = await mkdtemp(join(runtimePath, 'forgemark-setup-'));
  try {
    const checkout = join(stage, 'checkout');
    await mkdir(checkout);
    run('git', ['init', '--quiet'], checkout);
    if (archive) {
      const archivePath = resolve(archive);
      await verifyArchive(archivePath, sha256);
      run('tar', ['-xzf', archivePath, '--strip-components', '1', '-C', checkout], root);
    } else {
      run('git', ['fetch', '--depth=1', repository, commit], checkout);
      run('git', ['-c', 'core.autocrlf=false', 'checkout', '--detach', 'FETCH_HEAD'], checkout);
      if (run('git', ['rev-parse', 'HEAD'], checkout, true).trim() !== commit) {
        throw new Error('The downloaded Forgemark checkout does not match the locked commit.');
      }
    }

    const upstream = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
    if (upstream.name !== 'forgemark' || upstream.version !== version) {
      throw new Error('The upstream package does not match the Forgemark version in the lock.');
    }
    run('git', ['-c', 'core.autocrlf=false', 'apply', '--check', patchPath], checkout);
    run('git', ['-c', 'core.autocrlf=false', 'apply', patchPath], checkout);
    if (!(await lstat(join(checkout, 'src', 'components', 'FormulaCommentDialog.tsx'))).isFile()) {
      throw new Error('The Forgemark review patch did not reach the staged source tree.');
    }

    const npm = (...args) => run(process.execPath, [process.env.npm_execpath, ...args], checkout);
    npm('ci', ...(offline ? ['--offline'] : []));
    npm('run', 'build:bridge');
    npm('run', 'build:skill');
    await writeFile(join(checkout, stampName), `${stamp}\n`, { flag: 'wx' });
    await rename(checkout, target);
    console.log('Web AI Forge setup is ready. Run npm run demo.');
  } finally {
    await removeStage(stage, runtimePath);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
