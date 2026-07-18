import { execFile, execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'evalpilot-consumer-'));
const cache = join(temporary, 'npm-cache');

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

try {
  let tarball;
  if (process.argv[2]) {
    tarball = resolve(root, process.argv[2]);
    copyFileSync(tarball, join(temporary, tarball.split('/').at(-1)));
    tarball = join(temporary, tarball.split('/').at(-1));
  } else {
    const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: cache } });
    const [packed] = JSON.parse(output);
    tarball = join(temporary, packed.filename);
  }
  const consumer = join(temporary, 'consumer');
  execFileSync('mkdir', ['-p', consumer]);
  execFileSync('npm', ['init', '-y'], { cwd: consumer, stdio: 'ignore', env: { ...process.env, npm_config_cache: cache } });
  execFileSync('npm', ['install', '--ignore-scripts', tarball], { cwd: consumer, stdio: 'inherit', env: { ...process.env, npm_config_cache: cache } });
  const bin = join(consumer, 'node_modules', '.bin', 'evalpilot');
  const version = (await exec(bin, ['--version'], { cwd: consumer })).stdout.trim();
  const doctor = JSON.parse((await exec(bin, ['--data-dir', join(temporary, 'data'), 'doctor', '--json'], { cwd: consumer })).stdout);
  const port = await freePort();
  const dashboard = spawn(bin, ['--data-dir', join(temporary, 'data'), 'dashboard', '--port', String(port)], { cwd: consumer, env: { ...process.env, EVALPILOT_NO_OPEN: '1' }, stdio: 'ignore' });
  try {
    let health;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { health = await response.json(); break; } } catch { /* wait for server */ }
      await new Promise((wait) => setTimeout(wait, 250));
    }
    if (!health?.success) throw new Error('独立安装后的 Dashboard 健康接口没有就绪。');
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    if (!html.includes('<div id="root">')) throw new Error('独立安装后的 Dashboard 首页静态资源不可用。');
    process.stdout.write(`${JSON.stringify({ ok: true, version, contractVersion: health.data.contractVersion, dataRoot: doctor.dataRoot, dashboard: 'ready' })}\n`);
  } finally {
    dashboard.kill('SIGTERM');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
