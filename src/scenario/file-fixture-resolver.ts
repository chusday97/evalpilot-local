import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutableScenario, ScenarioBlocker } from './scenario-compiler.js';
import { ensureDirectory } from '../utils/file-system.js';

export type SyntheticFileKind = 'csv' | 'json' | 'txt';

export interface SyntheticFileFixturePlanItem {
  fixtureId: string;
  kind: SyntheticFileKind;
  filename: string;
  mimeType: string;
  content: string;
}

export interface SyntheticFileFixturePlan {
  caseId: string;
  sourcePreconditions: string[];
  fixtures: SyntheticFileFixturePlanItem[];
  reason: string;
}

export interface SyntheticFileFixture {
  fixtureId: string;
  caseId: string;
  kind: SyntheticFileKind;
  filename: string;
  mimeType: string;
  path: string;
  size: number;
  sourcePreconditions: string[];
}

export interface FileFixtureResolution {
  caseId: string;
  status: 'not_required' | 'ready' | 'blocked';
  plan: SyntheticFileFixturePlan | null;
  blockers: ScenarioBlocker[];
  reason: string;
}

const explicitFilePattern = /\b(?:file|upload|csv|json|txt|text file)\b|(?:文件|上传|CSV|JSON|TXT|文本文件)/i;
const unsupportedFilePattern = /\b(?:image|photo|picture|pdf|xlsx|xls|zip|archive|video|audio|docx|document)\b|(?:图片|照片|PDF|表格文件|压缩包|视频|音频|Word|文档)/i;

function isLoopback(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function requestedKinds(text: string): SyntheticFileKind[] {
  const kinds: SyntheticFileKind[] = [];
  if (/\bcsv\b|CSV/i.test(text)) kinds.push('csv');
  if (/\bjson\b|JSON/i.test(text)) kinds.push('json');
  if (/\b(?:txt|text file)\b|(?:TXT|文本文件)/i.test(text)) kinds.push('txt');
  return kinds;
}

function itemFor(caseId: string, kind: SyntheticFileKind): SyntheticFileFixturePlanItem {
  if (kind === 'csv') return { fixtureId: `${caseId}-fixture-csv`, kind, filename: 'evalpilot-fixture.csv', mimeType: 'text/csv', content: 'name,status\nEvalPilot fixture,active\n' };
  if (kind === 'json') return { fixtureId: `${caseId}-fixture-json`, kind, filename: 'evalpilot-fixture.json', mimeType: 'application/json', content: '{\n  "name": "EvalPilot fixture",\n  "status": "active"\n}\n' };
  return { fixtureId: `${caseId}-fixture-txt`, kind, filename: 'evalpilot-fixture.txt', mimeType: 'text/plain', content: 'EvalPilot synthetic fixture\n' };
}

export function resolveSyntheticFileFixtures(input: { scenario: ExecutableScenario; targetUrl: string }): FileFixtureResolution {
  if (input.scenario.readiness === 'ready') return { caseId: input.scenario.caseId, status: 'not_required', plan: null, blockers: [], reason: 'Scenario 不需要文件 Fixture。' };
  if (!input.scenario.blockers.length || input.scenario.blockers.some((blocker) => blocker.type !== 'needs_test_data')) {
    return { caseId: input.scenario.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: 'Scenario 同时包含非文件类 blocker，不能用合成文件绕过。' };
  }
  if (!isLoopback(input.targetUrl)) return { caseId: input.scenario.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: '合成文件 Fixture 第一版只用于 localhost / loopback 测试目标。' };
  const sources = input.scenario.blockers.map((blocker) => blocker.sourceValue);
  if (sources.some((value) => !explicitFilePattern.test(value))) return { caseId: input.scenario.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: '前置条件描述的是测试数据/种子状态而不是明确文件，不能擅自转换成上传文件。' };
  if (sources.some((value) => unsupportedFilePattern.test(value))) return { caseId: input.scenario.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: '该文件类型需要有语义内容或复杂二进制结构，第一版不会伪造。' };
  const explicitKinds = [...new Set(sources.flatMap(requestedKinds))];
  const kinds: SyntheticFileKind[] = explicitKinds.length ? explicitKinds : ['csv', 'json', 'txt'];
  const fixtures = kinds.map((kind) => itemFor(input.scenario.caseId, kind));
  return {
    caseId: input.scenario.caseId,
    status: 'ready',
    blockers: [],
    reason: explicitKinds.length ? `根据前置条件生成 ${explicitKinds.join('/').toUpperCase()} 合成 Fixture。` : '前置条件只要求普通测试文件，生成 CSV/JSON/TXT 白名单 Fixture 供页面约束选择。',
    plan: { caseId: input.scenario.caseId, sourcePreconditions: sources, fixtures, reason: '只生成固定小型文本 Fixture，不读取用户本地文件。' },
  };
}

export async function materializeSyntheticFileFixtures(plan: SyntheticFileFixturePlan, directory: string): Promise<SyntheticFileFixture[]> {
  await ensureDirectory(directory);
  const results: SyntheticFileFixture[] = [];
  for (const fixture of plan.fixtures) {
    const path = resolve(directory, fixture.filename);
    await writeFile(path, fixture.content, { encoding: 'utf8', flag: 'w' });
    results.push({ fixtureId: fixture.fixtureId, caseId: plan.caseId, kind: fixture.kind, filename: fixture.filename, mimeType: fixture.mimeType, path, size: Buffer.byteLength(fixture.content, 'utf8'), sourcePreconditions: plan.sourcePreconditions });
  }
  return results;
}
