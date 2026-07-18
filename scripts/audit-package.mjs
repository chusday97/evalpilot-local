import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'evalpilot-package-audit-'));
const cache = join(temporary, 'npm-cache');
const forbiddenPaths = [/(^|\/)\.evalpilot(\/|$)/i, /worktree/i, /screenshots?/i, /trace(?:\.|\/|$)/i, /\.project-journal/i, /(^|\/)HANDOFF\.md$/i, /(^|\/)PROGRESS\.md$/i];
const localUsername = basename(homedir()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const privateTerms = (process.env.EVALPILOT_PRIVATE_TERMS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const forbiddenText = [new RegExp(localUsername, 'i'), ...privateTerms.map((item) => new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')), /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

try {
  let tarball;
  if (process.argv[2]) {
    tarball = resolve(root, process.argv[2]);
    copyFileSync(tarball, join(temporary, basename(tarball)));
    tarball = join(temporary, basename(tarball));
  } else {
    const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    });
    const [packed] = JSON.parse(output);
    if (!packed?.filename) throw new Error('npm pack 没有返回 tarball。');
    tarball = join(temporary, packed.filename);
  }
  const packedBytes = statSync(tarball).size;
  if (packedBytes >= 10 * 1024 * 1024) throw new Error(`压缩包 ${packedBytes} bytes，超过 10MB 门禁。`);
  const archivedPaths = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const badNames = archivedPaths.filter((path) => forbiddenPaths.some((pattern) => pattern.test(path)));
  if (badNames.length) throw new Error(`发现禁止发布的路径：${badNames.join('、')}`);

  execFileSync('tar', ['-xzf', tarball, '-C', temporary]);
  const packageDirectory = join(temporary, 'package');
  const packageFiles = filesBelow(packageDirectory);
  if (packageFiles.length >= 250) throw new Error(`文件数 ${packageFiles.length}，超过 250 门禁。`);
  const badText = [];
  let unpackedBytes = 0;
  for (const path of packageFiles) {
    unpackedBytes += statSync(path).size;
    if (statSync(path).size > 2 * 1024 * 1024) continue;
    const content = readFileSync(path, 'utf8');
    if (forbiddenText.some((pattern) => pattern.test(content))) badText.push(relative(packageDirectory, path));
  }
  if (badText.length) throw new Error(`发现本机或私有内容：${badText.join('、')}`);
  process.stdout.write(`${JSON.stringify({ ok: true, filename: basename(tarball), packedBytes, unpackedBytes, fileCount: packageFiles.length, sensitiveMatches: 0 })}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
