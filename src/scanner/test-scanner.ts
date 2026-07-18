import type { EvidenceClaim, RepositoryEvidence, TestEvidence } from '../../types.js';

const frameworkPackages = ['vitest', 'jest', 'mocha', 'playwright', '@playwright/test', 'cypress', 'ava'];

export async function scanTests(repository: RepositoryEvidence): Promise<TestEvidence> {
  const files = repository.files.filter((file) => file.category === 'test').map((file) => file.path).sort();
  const packageJson = repository.packageJson ?? {};
  const packageScripts = packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts as Record<string, unknown>
    : {};
  const scripts = Object.fromEntries(
    Object.entries(packageScripts).filter(([name, value]) => name.startsWith('test') && typeof value === 'string'),
  ) as Record<string, string>;
  const dependencies = {
    ...(packageJson.dependencies && typeof packageJson.dependencies === 'object' ? packageJson.dependencies as Record<string, unknown> : {}),
    ...(packageJson.devDependencies && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies as Record<string, unknown> : {}),
  };
  const frameworks = frameworkPackages.filter((name) => name in dependencies);
  const claims: EvidenceClaim[] = [];
  if (files.length > 0) claims.push({
    claim: `仓库包含 ${files.length} 个测试文件`,
    sourceType: 'repository',
    source: files[0] ?? repository.projectRoot,
    status: 'verified',
  });
  for (const name of Object.keys(scripts)) claims.push({
    claim: `package.json 定义测试脚本 ${name}`,
    sourceType: 'repository',
    source: 'package.json',
    status: 'verified',
  });
  for (const name of frameworks) claims.push({
    claim: `package.json 声明测试依赖 ${name}`,
    sourceType: 'repository',
    source: 'package.json',
    status: 'verified',
  });
  return { files, scripts, frameworks, claims, scannedAt: new Date().toISOString() };
}
