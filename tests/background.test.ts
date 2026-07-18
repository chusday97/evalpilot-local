import { describe, expect, it } from 'vitest';
import type { BackgroundEvidence } from '../src/generation/background-builder.js';
import { buildProjectBackground, renderBackgroundMarkdown } from '../src/generation/background-builder.js';

function fixture(): BackgroundEvidence {
  return {
    repository: {
      projectRoot: '/fixture',
      files: [
        { path: 'src/ai-client.ts', category: 'source', size: 10 },
        { path: 'src/rules/policy.ts', category: 'source', size: 10 },
      ],
      packageJson: { name: 'fixture', dependencies: { react: '1', vite: '1' } },
      envVariableNames: [],
      claims: [{ claim: 'package name fixture', sourceType: 'repository', source: 'package.json', status: 'verified' }],
      scannedAt: new Date().toISOString(),
    },
    documents: {
      documents: [{ path: 'README.md', title: 'Fixture Product', excerpt: 'Declared product context' }],
      claims: [{ claim: 'Fixture Product', sourceType: 'document', source: 'README.md', status: 'declared' }],
      scannedAt: new Date().toISOString(),
    },
    routes: {
      routes: [
        { path: '/', source: 'src/App.tsx', status: 'verified' },
        { path: '/search', source: 'src/App.tsx', status: 'verified' },
      ],
      sourceFiles: ['src/App.tsx'],
      scannedAt: new Date().toISOString(),
    },
    pages: [
      {
        url: 'http://localhost:3000/',
        title: 'Fixture Product',
        visibleText: 'Search',
        links: [],
        buttons: [{ text: '删除账户', risk: 'high' }],
        inputs: [],
        forms: 0,
        dialogs: 0,
        accessibility: { lang: 'en', headings: [], imageAltMissing: 0 },
        screenshot: 'evidence/screenshots/page.png',
        consoleErrors: [],
        networkErrors: [],
        exploredAt: new Date().toISOString(),
      },
    ],
  };
}

describe('background generation', () => {
  it('keeps direct route/page facts verified and business assumptions explicit', () => {
    const background = buildProjectBackground(fixture());

    expect(background.projectName).toBe('fixture');
    expect(background.projectType).toBe('React + Vite Web 产品');
    expect(background.capabilities).toHaveLength(2);
    expect(background.capabilities.map((item) => item.name)).toEqual(['首页', '页面 search']);
    expect(background.primaryJourneys).toEqual(['从入口页进入页面 search']);
    expect(background.capabilities.every((capability) => capability.status === 'verified')).toBe(true);
    expect(background.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'declared' })]));
    expect(background.assumptions).not.toHaveLength(0);
    expect(background.unknowns).toContain('核心功能的业务硬约束');
    expect(background.highRiskOperations).toEqual(['删除账户（http://localhost:3000/）']);
    expect(background.fieldStatuses.targetUsers).toBe('unknown');
    expect(background.fieldStatuses.userTasks).toBe('inferred');
    expect(background.fieldEvidence.targetUsers?.[0]?.status).toBe('unknown');
    expect(Object.keys(background.fieldStatuses).sort()).toEqual(Object.keys(background.fieldEvidence).sort());
  });

  it('renders evidence status and source into Markdown', () => {
    const markdown = renderBackgroundMarkdown(buildProjectBackground(fixture()));
    expect(markdown).toContain('[declared] Fixture Product — README.md');
    expect(markdown).toContain('状态：verified');
    expect(markdown).toContain('目标用户（unknown）');
  });

  it('prefers a product document title over a generic starter package name', () => {
    const evidence = fixture();
    evidence.repository.packageJson = { name: 'react-example', dependencies: { react: '1', vite: '1' } };
    expect(buildProjectBackground(evidence).projectName).toBe('Fixture Product');
  });

  it('derives unrelated product capabilities from route evidence without domain vocabulary', () => {
    const evidence = fixture();
    evidence.routes.routes = [
      { path: '/', source: 'router.ts', status: 'verified' },
      { path: '/invoices', source: 'router.ts', status: 'verified' },
      { path: '/team-settings', source: 'router.ts', status: 'verified' },
    ];
    const background = buildProjectBackground(evidence);
    expect(background.capabilities.map((item) => item.name)).toEqual(['首页', '页面 invoices', '页面 team settings']);
    expect(background.primaryJourneys).toEqual(['从入口页进入页面 invoices']);
  });
});
