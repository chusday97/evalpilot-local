import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeProject } from '../src/config/initializer.js';
import { loadConfig, parseTargetUrl, resolveProjectDirectory } from '../src/config/project-config.js';
import { getProjectStatus } from '../src/config/status.js';
import { EvalPilotError } from '../src/utils/errors.js';

const successfulFetch = (() => Promise.resolve(new Response('ok', { status: 200 }))) as typeof fetch;

async function createFixture(): Promise<{ cwd: string; project: string; url: string; outputDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'evalpilot-init-'));
  const cwd = resolve(root, 'evalpilot');
  const project = resolve(root, 'target');
  await mkdir(cwd);
  await mkdir(project);

  return { cwd, project, url: 'http://127.0.0.1:3000', outputDir: resolve(cwd, '.evalpilot') };
}

describe('target URL validation', () => {
  it('accepts HTTP(S) and normalizes a trailing slash', () => {
    expect(parseTargetUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(parseTargetUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it.each(['', 'localhost:3000', 'file:///tmp/test', 'ftp://example.com'])('rejects unsupported URL %s', (url) => {
    expect(() => parseTargetUrl(url)).toThrow(EvalPilotError);
  });
});

describe('project path validation', () => {
  it('accepts a real directory and returns an absolute path', async () => {
    const fixture = await createFixture();
    await expect(resolveProjectDirectory(fixture.project)).resolves.toBe(fixture.project);
  });

  it('rejects a missing path and a regular file', async () => {
    const fixture = await createFixture();
    await expect(resolveProjectDirectory(resolve(fixture.project, 'missing'))).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
    const file = resolve(fixture.project, 'file.txt');
    await writeFile(file, 'not a directory');
    await expect(resolveProjectDirectory(file)).rejects.toMatchObject({ code: 'PROJECT_NOT_DIRECTORY' });
  });
});

describe('initialization', () => {
  it('creates the complete workspace without reporting later stages as complete', async () => {
    const fixture = await createFixture();
    const config = await initializeProject({
      ...fixture,
      fetchImplementation: successfulFetch,
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    });

    expect(config.projectRoot).toBe(fixture.project);
    expect(config.targetUrl).toBe(fixture.url);
    await expect(loadConfig(fixture.cwd, fixture.outputDir)).resolves.toEqual(config);
    expect(await readFile(resolve(fixture.cwd, '.gitignore'), 'utf8')).toContain('.evalpilot/secrets/');
    await expect(readFile(resolve(config.outputDir, 'evidence', 'apis.json'), 'utf8')).resolves.toContain('"apis"');
    await expect(readFile(resolve(config.outputDir, 'evidence', 'tests.json'), 'utf8')).resolves.toContain('"frameworks"');
    await expect(readFile(resolve(config.outputDir, 'taxonomy.yaml'), 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(resolve(config.outputDir, 'rubrics.yaml'), 'utf8')).resolves.toBe('{}\n');
    await expect(readFile(resolve(config.outputDir, 'release-gates.yaml'), 'utf8')).resolves.toContain('releaseGates');
    expect(await getProjectStatus(config)).toMatchObject({
      stages: {
        initialized: true,
        scanned: false,
        backgroundGenerated: false,
        blueprintGenerated: false,
        casesGenerated: false,
        reportGenerated: false,
      },
    });
  });

  it('does not overwrite an existing EvalPilot directory', async () => {
    const fixture = await createFixture();
    await initializeProject({ ...fixture, fetchImplementation: successfulFetch });
    const marker = resolve(fixture.cwd, '.evalpilot', 'marker.txt');
    await writeFile(marker, 'keep');

    await expect(initializeProject({ ...fixture, fetchImplementation: successfulFetch })).rejects.toMatchObject({
      code: 'ALREADY_INITIALIZED',
    });
    await expect(readFile(marker, 'utf8')).resolves.toBe('keep');
  });

  it('does not create files when the target URL is unreachable', async () => {
    const fixture = await createFixture();
    const rejectingFetch = (() => Promise.reject(new Error('connection refused'))) as typeof fetch;

    await expect(initializeProject({ ...fixture, fetchImplementation: rejectingFetch })).rejects.toMatchObject({
      code: 'TARGET_UNREACHABLE',
    });
    await expect(readFile(resolve(fixture.cwd, '.evalpilot', 'config.yaml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
