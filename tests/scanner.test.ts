import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalPilotConfig, PageEvidence } from '../types.js';
import { scanDocuments } from '../src/scanner/document-scanner.js';
import { scanGit } from '../src/scanner/git-scanner.js';
import { scanRepository } from '../src/scanner/repository-scanner.js';
import { scanRoutes } from '../src/scanner/route-scanner.js';
import { scanProject } from '../src/scanner/scan-project.js';
import { scanApis } from '../src/scanner/api-scanner.js';
import { scanTests } from '../src/scanner/test-scanner.js';

async function createTargetFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'evalpilot-scan-'));
  await mkdir(resolve(root, 'src'), { recursive: true });
  await mkdir(resolve(root, 'docs'), { recursive: true });
  await mkdir(resolve(root, 'tests'), { recursive: true });
  await mkdir(resolve(root, 'node_modules', 'secret-package'), { recursive: true });
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'fixture-product', scripts: { dev: 'vite', test: 'vitest run' }, dependencies: { react: '1.0.0' }, devDependencies: { vitest: '1.0.0' } }),
  );
  await writeFile(resolve(root, 'README.md'), '# Fixture Product\n\nA declared test product.');
  await writeFile(resolve(root, 'docs', 'PRD.md'), '# Product Requirements\n\nUsers can search.');
  await writeFile(
    resolve(root, 'src', 'router.tsx'),
    `<Routes><Route path="/" element={<Home />} /><Route path="/search" element={<Search />} /></Routes>\nfetch('/api/search')`,
  );
  await writeFile(resolve(root, 'tests', 'search.test.ts'), 'it("searches", () => {})');
  await writeFile(resolve(root, '.env'), 'SECRET_TOKEN=never-read\n');
  await writeFile(resolve(root, '.env.example'), 'PUBLIC_API_URL=\nOPTIONAL_FLAG=true\n');
  await writeFile(resolve(root, 'node_modules', 'secret-package', 'index.js'), 'TOKEN="leak"');
  await writeFile(resolve(root, 'dist', 'bundle.js'), 'built');
  return root;
}

describe('repository scanner', () => {
  it('extracts repository facts without secrets, dependencies, or build output', async () => {
    const root = await createTargetFixture();
    const result = await scanRepository(root);
    const paths = result.files.map((file) => file.path);

    expect(paths).toContain('package.json');
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('.env');
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('dist/'))).toBe(false);
    expect(result.envVariableNames).toEqual(['OPTIONAL_FLAG', 'PUBLIC_API_URL']);
    expect(result.packageJson?.name).toBe('fixture-product');
  });

  it('extracts declared documents and static routes with source paths', async () => {
    const root = await createTargetFixture();
    const repository = await scanRepository(root);
    const documents = await scanDocuments(repository);
    const routes = await scanRoutes(repository);

    expect(documents.documents.map((document) => document.path)).toEqual(['docs/PRD.md', 'README.md']);
    expect(documents.claims.every((claim) => claim.status === 'declared')).toBe(true);
    expect(routes.routes).toEqual([
      { path: '/', source: 'src/router.tsx', status: 'verified' },
      { path: '/search', source: 'src/router.tsx', status: 'verified' },
    ]);
  });

  it('returns an unavailable Git fact instead of failing a non-Git target', async () => {
    const root = await createTargetFixture();
    await expect(scanGit(root)).resolves.toMatchObject({ available: false, commits: [], changedFiles: [] });
  });

  it('extracts only explicit API references and test metadata as verified facts', async () => {
    const root = await createTargetFixture();
    const repository = await scanRepository(root);
    const apis = await scanApis(repository);
    const tests = await scanTests(repository);

    expect(apis.apis).toContainEqual({ path: '/api/search', method: null, source: 'src/router.tsx', status: 'verified' });
    expect(apis.claims.every((claim) => claim.status === 'verified')).toBe(true);
    expect(tests.files).toEqual(['tests/search.test.ts']);
    expect(tests.scripts).toEqual({ test: 'vitest run' });
    expect(tests.frameworks).toEqual(['vitest']);
  });
});

describe('scan integration', () => {
  it('persists repository and browser evidence from one orchestration call', async () => {
    const projectRoot = await createTargetFixture();
    const workingRoot = await mkdtemp(join(tmpdir(), 'evalpilot-output-'));
    const outputDir = resolve(workingRoot, '.evalpilot');
    await mkdir(resolve(outputDir, 'evidence', 'screenshots'), { recursive: true });
    const config: EvalPilotConfig = {
      version: 1,
      projectRoot,
      targetUrl: 'http://localhost:3000',
      outputDir,
      browser: 'chromium',
      createdAt: new Date().toISOString(),
    };
    const browserEvidence: PageEvidence = {
      url: config.targetUrl,
      title: 'Fixture Product',
      visibleText: 'Search',
      links: [],
      buttons: [{ text: 'Search', risk: 'safe' }],
      inputs: [{ text: 'query', type: 'text', risk: 'safe' }],
      forms: 1,
      dialogs: 0,
      accessibility: { lang: 'en', headings: ['Fixture Product'], imageAltMissing: 0 },
      screenshot: 'fixture.png',
      consoleErrors: [],
      networkErrors: [],
      exploredAt: new Date().toISOString(),
    };
    const result = await scanProject(config, async () => [browserEvidence]);

    expect(result).toMatchObject({ documentCount: 2, routeCount: 2, apiCount: 1, testFileCount: 1, pageCount: 1 });
    const pages = JSON.parse(await readFile(resolve(outputDir, 'evidence', 'pages.json'), 'utf8')) as PageEvidence[];
    expect(pages[0]?.title).toBe('Fixture Product');
    const repository = JSON.parse(await readFile(resolve(outputDir, 'evidence', 'repository.json'), 'utf8')) as {
      scannedAt: string;
    };
    expect(repository.scannedAt).toBeTruthy();
    expect(JSON.parse(await readFile(resolve(outputDir, 'evidence', 'apis.json'), 'utf8')).apis).toHaveLength(1);
    expect(JSON.parse(await readFile(resolve(outputDir, 'evidence', 'tests.json'), 'utf8')).files).toHaveLength(1);
  });
});
