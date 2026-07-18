import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { EvalPilotConfig, ProjectProfile, ProjectRegistry } from '../../types.js';
import { loadConfig } from '../config/project-config.js';
import { projectRegistrySchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';
import { pathExists, writeJsonAtomic } from '../utils/file-system.js';
import { isLegacyDataRoot, resolveDataRoot } from '../runtime/paths.js';

const registryPath = (cwd: string) => resolve(resolveDataRoot(cwd), 'projects.json');

function legacyProfile(config: EvalPilotConfig): ProjectProfile {
  const now = config.createdAt;
  return { projectId: 'legacy-current', name: basename(config.projectRoot), projectRoot: config.projectRoot, targetUrl: config.targetUrl, outputDir: config.outputDir, browser: 'chromium', startCommand: null, status: 'stopped', importSource: 'legacy', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now };
}

export async function loadProjectRegistry(cwd: string): Promise<ProjectRegistry> {
  const path = registryPath(cwd);
  if (await pathExists(path)) {
    const parsed = projectRegistrySchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (!parsed.success) throw new EvalPilotError('多项目注册表损坏，未覆盖原文件。', 'PROJECT_REGISTRY_INVALID');
    return parsed.data;
  }
  let registry: ProjectRegistry = { version: 1, activeProjectId: null, projects: [] };
  try {
    const profile = legacyProfile(await loadConfig(cwd));
    registry = { version: 1, activeProjectId: profile.projectId, projects: [profile] };
  } catch (error) {
    if (!(error instanceof EvalPilotError) || error.code !== 'NOT_INITIALIZED') throw error;
  }
  if (!isLegacyDataRoot(cwd)) await writeJsonAtomic(path, registry);
  return registry;
}

export async function saveProjectRegistry(cwd: string, registry: ProjectRegistry): Promise<void> {
  if (isLegacyDataRoot(cwd)) throw new EvalPilotError('旧 .evalpilot 当前为只读兼容模式；请先运行 evalpilot migrate --confirmed。', 'LEGACY_DATA_READ_ONLY');
  const parsed = projectRegistrySchema.safeParse(registry);
  if (!parsed.success) throw new EvalPilotError('多项目注册表校验失败。', 'PROJECT_REGISTRY_INVALID');
  await writeJsonAtomic(registryPath(cwd), parsed.data);
}

export async function activeProject(cwd: string): Promise<ProjectProfile> {
  const registry = await loadProjectRegistry(cwd);
  const project = registry.projects.find((item) => item.projectId === registry.activeProjectId) ?? registry.projects[0];
  if (!project) throw new EvalPilotError('尚未添加项目。', 'PROJECT_REQUIRED');
  return project;
}

export async function configForProject(cwd: string, projectId?: string): Promise<EvalPilotConfig> {
  const registry = await loadProjectRegistry(cwd);
  const project = registry.projects.find((item) => item.projectId === (projectId ?? registry.activeProjectId));
  if (!project) throw new EvalPilotError(`没有找到项目：${projectId ?? '当前项目'}`, 'PROJECT_NOT_FOUND');
  return { version: 1, projectRoot: project.projectRoot, targetUrl: project.targetUrl, outputDir: project.outputDir, browser: 'chromium', createdAt: project.createdAt };
}
