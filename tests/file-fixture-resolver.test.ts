import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { materializeSyntheticFileFixtures, resolveSyntheticFileFixtures } from '../src/scenario/file-fixture-resolver.js';

function scenario(sourceValue: string): ExecutableScenario {
  return {
    scenarioId: 'scenario-file',
    projectId: 'project-file',
    caseId: 'case-file',
    capabilityId: 'cap-file',
    taskId: 'task-file',
    goal: '上传测试文件',
    startingUrl: 'http://127.0.0.1:3000/',
    readiness: 'needs_test_data',
    blockers: [{ blockerId: 'case-file-precondition-1', type: 'needs_test_data', summary: '需要测试文件。', source: 'precondition', sourceValue }],
    preconditions: [{ text: sourceValue, status: 'unresolved', reason: '需要测试文件。' }],
    knownInformationKeys: [],
    generatedAt: '2026-08-12T08:00:00.000Z',
  };
}

describe('Synthetic File Fixture Resolver', () => {
  it('creates only a CSV fixture when the prerequisite explicitly asks for CSV', () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('测试 CSV 文件已准备'), targetUrl: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('ready');
    expect(result.plan?.fixtures).toEqual([expect.objectContaining({ kind: 'csv', filename: 'evalpilot-fixture.csv', mimeType: 'text/csv' })]);
  });

  it('offers the text whitelist when the prerequisite only says ordinary test file', () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('待上传测试文件已准备'), targetUrl: 'http://localhost:3000/' });
    expect(result.status).toBe('ready');
    expect(result.plan?.fixtures.map((item) => item.kind)).toEqual(['csv', 'json', 'txt']);
  });

  it('does not convert generic test data into an uploaded file', () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('测试数据已准备'), targetUrl: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('blocked');
    expect(result.plan).toBeNull();
    expect(result.reason).toContain('不能擅自转换');
  });

  it('keeps semantically rich or binary file types blocked', () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('测试 PDF 文件已准备'), targetUrl: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('不会伪造');
  });

  it('does not materialize fixtures for a remote target', () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('测试 CSV 文件已准备'), targetUrl: 'https://example.com/' });
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('localhost');
  });

  it('materializes only fixed synthetic content into the requested evaluation directory', async () => {
    const result = resolveSyntheticFileFixtures({ scenario: scenario('测试 JSON 文件已准备'), targetUrl: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('ready');
    const directory = await mkdtemp(join(tmpdir(), 'evalpilot-file-fixture-'));
    const fixtures = await materializeSyntheticFileFixtures(result.plan!, directory);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.filename).toBe('evalpilot-fixture.json');
    expect(fixtures[0]?.path.startsWith(directory)).toBe(true);
    const content = await readFile(fixtures[0]!.path, 'utf8');
    expect(content).toContain('EvalPilot fixture');
    expect(content).not.toContain('/Users/');
    expect(content).not.toContain('/home/');
  });
});
