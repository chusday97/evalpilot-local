import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type {
  Capability,
  DocumentEvidence,
  EvidenceClaim,
  EvalPilotConfig,
  PageEvidence,
  ProjectBackground,
  RepositoryEvidence,
  RouteEvidence,
} from '../../types.js';
import { projectBackgroundSchema } from '../schemas/background.js';
import { EvalPilotError } from '../utils/errors.js';
import { writeTextAtomic, writeYamlAtomic } from '../utils/file-system.js';

export interface BackgroundEvidence {
  repository: RepositoryEvidence;
  documents: DocumentEvidence;
  routes: RouteEvidence;
  pages: PageEvidence[];
}

function nameForRoute(path: string): string {
  if (path === '/') return '首页';
  const segment = path.split('/').filter(Boolean).at(-1) ?? path;
  let readable = segment;
  try { readable = decodeURIComponent(segment); } catch { /* keep encoded route segment */ }
  return `页面 ${readable.replace(/[-_]+/g, ' ')}`;
}

function idForRoute(route: string): string {
  const normalized = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `cap-${normalized || 'home'}`;
}

function detectProjectType(repository: RepositoryEvidence): string {
  const dependencies = {
    ...((repository.packageJson?.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((repository.packageJson?.devDependencies as Record<string, unknown> | undefined) ?? {}),
  };
  if ('next' in dependencies) return 'Next.js Web 产品';
  if ('react' in dependencies && 'vite' in dependencies) return 'React + Vite Web 产品';
  if ('react' in dependencies) return 'React Web 产品';
  return 'Web 产品（具体框架待确认）';
}

function routeCapabilities(routes: RouteEvidence): Capability[] {
  const usableRoutes = routes.routes.filter((route) => route.path.startsWith('/') && route.path !== '/3d-demo');
  const uniqueRoutes = [...new Map(usableRoutes.map((route) => [route.path, route])).values()];
  return uniqueRoutes.map((route) => ({
    id: idForRoute(route.path),
    name: nameForRoute(route.path),
    description: `项目在 ${route.path} 提供可路由访问的产品能力；具体业务成功条件需要在评测蓝图中审核。`,
    status: 'verified',
    routes: [route.path],
    evidence: [
      {
        claim: `代码定义路由 ${route.path}`,
        sourceType: 'repository',
        source: route.source,
        status: 'verified',
      },
    ],
    dependencies: [],
    risks: route.path === '/login' ? ['认证状态和测试账号需单独提供'] : [],
  }));
}

export function buildProjectBackground(evidence: BackgroundEvidence): ProjectBackground {
  const packageName = evidence.repository.packageJson?.name;
  const usablePackageName =
    typeof packageName === 'string' && !/^(react-example|vite-project|web-app|app)$/i.test(packageName) ? packageName : null;
  const documentProductName = evidence.documents.documents[0]?.title
    .replace(/\s+(?:产品需求文档|PRD).*$/i, '')
    .trim();
  const projectName =
    usablePackageName || documentProductName || (typeof packageName === 'string' && packageName) || basename(evidence.repository.projectRoot);
  const dependencies = Object.keys(
    (evidence.repository.packageJson?.dependencies as Record<string, unknown> | undefined) ?? {},
  ).sort();
  const capabilities = routeCapabilities(evidence.routes);
  if (capabilities.length === 0) {
    capabilities.push({
      id: 'cap-entry-page',
      name: evidence.pages[0]?.title || '入口页面',
      description: '浏览器已验证入口页面可访问，但静态路由尚未识别。',
      status: evidence.pages.length > 0 ? 'verified' : 'unknown',
      routes: evidence.pages.map((page) => new URL(page.url).pathname),
      evidence: [
        {
          claim: evidence.pages.length > 0 ? '浏览器成功打开入口页面' : '入口页面尚未验证',
          sourceType: 'browser',
          source: evidence.pages[0]?.url ?? evidence.repository.projectRoot,
          status: evidence.pages.length > 0 ? 'verified' : 'unknown',
        },
      ],
      dependencies: [],
      risks: [],
    });
  }

  const browserClaims: EvidenceClaim[] = evidence.pages.map((page) => ({
    claim: `浏览器成功打开 ${page.url}，页面标题为 ${page.title || '（空）'}`,
    sourceType: 'browser',
    source: page.screenshot ?? page.url,
    status: 'verified',
  }));
  const highRiskOperations = evidence.pages.flatMap((page) =>
    page.buttons.filter((button) => button.risk === 'high').map((button) => `${button.text || '未命名按钮'}（${page.url}）`),
  );
  const aiFiles = evidence.repository.files.filter((file) => /(^|\/)(ai|copilot)|ai[-_.]/i.test(file.path));
  const ruleFiles = evidence.repository.files.filter((file) => /(rule|compatibility|policy|validator)/i.test(file.path));
  const repositorySource = evidence.repository.claims[0] ?? {
    claim: '仓库扫描结果可用', sourceType: 'repository' as const, source: evidence.repository.projectRoot, status: 'verified' as const,
  };
  const documentSource = evidence.documents.claims[0] ?? {
    claim: '未找到可确认业务背景的产品文档', sourceType: 'document' as const, source: evidence.repository.projectRoot, status: 'unknown' as const,
  };
  const browserSource = browserClaims[0] ?? {
    claim: '浏览器页面状态尚未验证', sourceType: 'browser' as const, source: evidence.repository.projectRoot, status: 'unknown' as const,
  };
  const routeSource: EvidenceClaim = capabilities[0]?.evidence[0] ?? {
    claim: '静态路由不足，用户任务和路径待确认', sourceType: 'repository', source: evidence.repository.projectRoot, status: 'unknown',
  };
  const inferredRouteSource: EvidenceClaim = {
    ...routeSource,
    claim: '用户任务和主路径由已验证入口推断，仍需真实执行确认',
    status: 'inferred',
  };
  const aiSource: EvidenceClaim = {
    claim: aiFiles.length ? `文件路径中发现 ${aiFiles.length} 个 AI 相关候选` : '未确认 AI 职责',
    sourceType: 'repository',
    source: aiFiles[0]?.path ?? evidence.repository.projectRoot,
    status: aiFiles.length ? 'inferred' : 'unknown',
  };
  const ruleSource: EvidenceClaim = {
    claim: ruleFiles.length ? `文件路径中发现 ${ruleFiles.length} 个规则相关候选` : '未确认独立规则系统职责',
    sourceType: 'repository',
    source: ruleFiles[0]?.path ?? evidence.repository.projectRoot,
    status: ruleFiles.length ? 'inferred' : 'unknown',
  };
  const unknownSource: EvidenceClaim = {
    claim: '当前证据不足，需要用户或直接运行证据确认',
    sourceType: 'user',
    source: 'needs_human_review',
    status: 'unknown',
  };
  const fieldStatuses = {
    projectName: usablePackageName ? 'verified' : evidence.documents.documents.length ? 'declared' : 'verified',
    projectType: evidence.repository.packageJson ? 'verified' : 'unknown',
    currentStatus: evidence.pages.length > 0 ? 'verified' : 'declared',
    problem: evidence.documents.documents.length ? 'declared' : 'unknown',
    targetUsers: 'unknown',
    userTasks: 'inferred',
    capabilities: capabilities.every((capability) => capability.status === 'verified') ? 'verified' : 'unknown',
    corePages: capabilities.every((capability) => capability.status === 'verified') ? 'verified' : 'unknown',
    primaryJourneys: 'inferred',
    aiResponsibilities: aiFiles.length ? 'inferred' : 'unknown',
    ruleResponsibilities: ruleFiles.length ? 'inferred' : 'unknown',
    externalDependencies: evidence.repository.packageJson ? 'verified' : 'unknown',
    highRiskOperations: evidence.pages.length > 0 ? 'verified' : 'unknown',
    knownLimitations: 'verified',
    assumptions: 'inferred',
    unknowns: 'unknown',
    evidence: 'verified',
  } as const;
  const fieldEvidence: Record<string, EvidenceClaim[]> = {
    projectName: [usablePackageName ? repositorySource : evidence.documents.documents.length ? documentSource : repositorySource],
    projectType: [repositorySource],
    currentStatus: [evidence.pages.length > 0 ? browserSource : repositorySource],
    problem: [evidence.documents.documents.length ? documentSource : unknownSource],
    targetUsers: [unknownSource],
    userTasks: [inferredRouteSource],
    capabilities: capabilities.flatMap((capability) => capability.evidence),
    corePages: [routeSource],
    primaryJourneys: [inferredRouteSource],
    aiResponsibilities: [aiSource],
    ruleResponsibilities: [ruleSource],
    externalDependencies: [evidence.repository.packageJson ? repositorySource : unknownSource],
    highRiskOperations: [evidence.pages.length > 0 ? browserSource : unknownSource],
    knownLimitations: [{
      claim: `浏览器只读探索记录包含 ${evidence.pages.length} 个页面`,
      sourceType: 'browser',
      source: 'evidence/pages.json',
      status: 'verified',
    }],
    assumptions: [inferredRouteSource],
    unknowns: [unknownSource],
    evidence: [repositorySource],
  };

  return projectBackgroundSchema.parse({
    projectName,
    projectType: detectProjectType(evidence.repository),
    currentStatus: evidence.pages.length > 0 ? 'verified' : 'declared',
    problem: evidence.documents.documents.length
      ? `项目文档声明了产品背景，需以 ${evidence.documents.documents[0]?.path} 为主要人工审核来源。`
      : '当前证据无法确认产品解决的业务问题。',
    targetUsers: ['目标用户尚需从产品文档或用户确认中审核'],
    userTasks: capabilities.map((capability) => `使用${capability.name}`).slice(0, 10),
    capabilities,
    corePages: capabilities.flatMap((capability) => capability.routes),
    primaryJourneys: capabilities.length > 1
      ? [`从入口页进入${capabilities.find((item) => !item.routes.includes('/'))?.name ?? capabilities[0]?.name}`]
      : ['入口页访问路径已验证，后续交互路径待浏览器案例确认'],
    aiResponsibilities: aiFiles.length
      ? [`发现 ${aiFiles.length} 个名称含 AI/Copilot 的文件；具体职责不可仅凭文件名确认`]
      : ['未从文件路径确认 AI 能力'],
    ruleResponsibilities: ruleFiles.length
      ? [`发现 ${ruleFiles.length} 个规则/校验相关文件；业务约束需人工审核`]
      : ['未从文件路径确认独立规则系统'],
    externalDependencies: dependencies,
    highRiskOperations: [...new Set(highRiskOperations)],
    knownLimitations: [
      `本次浏览器只读探索覆盖 ${evidence.pages.length} 个页面`,
      '高风险操作未自动点击',
    ],
    assumptions: ['主路径根据已验证路由和入口页推断，需由后续案例执行确认'],
    unknowns: ['目标用户的精确定义', '核心功能的业务硬约束', '登录测试账号和权限边界', 'AI 输出的业务标准答案'],
    evidence: [...evidence.repository.claims, ...evidence.documents.claims, ...browserClaims],
    fieldStatuses,
    fieldEvidence,
    generatedAt: new Date().toISOString(),
  });
}

function markdownList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

export function renderBackgroundMarkdown(background: ProjectBackground): string {
  return `# ${background.projectName} — 产品背景\n\n` +
    `> 生成时间：${background.generatedAt}。事实等级：verified=直接证据，declared=文档声明，inferred=推断，unknown=未知。\n\n` +
    `## 基本信息\n\n- 项目类型：[${background.fieldStatuses.projectType}] ${background.projectType}\n- 当前状态：[${background.fieldStatuses.currentStatus}] ${background.currentStatus}\n- 产品问题：[${background.fieldStatuses.problem}] ${background.problem}\n\n` +
    `## 核心能力\n\n${background.capabilities.map((capability) => `### ${capability.name}\n\n- ID：${capability.id}\n- 状态：${capability.status}\n- 路由：${capability.routes.join(', ') || '暂无'}\n- 说明：${capability.description}\n- 来源：${capability.evidence.map((item) => `${item.source} (${item.status})`).join(', ')}`).join('\n\n')}\n\n` +
    `## 目标用户（${background.fieldStatuses.targetUsers}）\n\n${markdownList(background.targetUsers)}\n\n## 用户任务（${background.fieldStatuses.userTasks}）\n\n${markdownList(background.userTasks)}\n\n` +
    `## 主路径（${background.fieldStatuses.primaryJourneys}）\n\n${markdownList(background.primaryJourneys)}\n\n## AI 职责（${background.fieldStatuses.aiResponsibilities}）\n\n${markdownList(background.aiResponsibilities)}\n\n` +
    `## 规则系统职责\n\n${markdownList(background.ruleResponsibilities)}\n\n## 外部依赖\n\n${markdownList(background.externalDependencies)}\n\n` +
    `## 高风险操作\n\n${markdownList(background.highRiskOperations)}\n\n## 已知限制\n\n${markdownList(background.knownLimitations)}\n\n` +
    `## 当前假设\n\n${markdownList(background.assumptions)}\n\n## 未知信息\n\n${markdownList(background.unknowns)}\n\n` +
    `## 证据来源\n\n${background.evidence.map((item) => `- [${item.status}] ${item.claim} — ${item.source}`).join('\n')}\n`;
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    throw new EvalPilotError(`无法读取背景生成所需证据 ${path}：${String(error)}`, 'BACKGROUND_EVIDENCE_INVALID');
  }
}

export async function generateBackground(config: EvalPilotConfig): Promise<ProjectBackground> {
  const evidenceDir = resolve(config.outputDir, 'evidence');
  const evidence: BackgroundEvidence = {
    repository: await readJson(resolve(evidenceDir, 'repository.json')),
    documents: await readJson(resolve(evidenceDir, 'documents.json')),
    routes: await readJson(resolve(evidenceDir, 'routes.json')),
    pages: await readJson(resolve(evidenceDir, 'pages.json')),
  };
  const background = buildProjectBackground(evidence);
  await Promise.all([
    writeYamlAtomic(resolve(config.outputDir, 'project-background.yaml'), background),
    writeTextAtomic(resolve(config.outputDir, 'PRODUCT_BACKGROUND.md'), renderBackgroundMarkdown(background)),
  ]);
  return background;
}
