import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EvalPilotConfig } from '../../types.js';
import { EvalPilotError } from '../utils/errors.js';
import { pathExists, readYamlFile } from '../utils/file-system.js';
import { resolveDataRoot } from '../runtime/paths.js';
import { evalPilotConfigSchema, httpUrlSchema } from './schema.js';

export const CONFIG_DIRECTORY = '.evalpilot';
export const CONFIG_FILE = 'config.yaml';

export async function resolveProjectDirectory(input: string): Promise<string> {
  const path = resolve(input);
  try {
    const metadata = await stat(path);
    if (!metadata.isDirectory()) {
      throw new EvalPilotError(`被测项目路径不是目录：${path}`, 'PROJECT_NOT_DIRECTORY');
    }
    return path;
  } catch (error) {
    if (error instanceof EvalPilotError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new EvalPilotError(`被测项目路径不存在：${path}`, 'PROJECT_NOT_FOUND');
    }
    throw new EvalPilotError(`无法读取被测项目路径：${path}`, 'PROJECT_UNREADABLE');
  }
}

export function parseTargetUrl(input: string): string {
  const parsed = httpUrlSchema.safeParse(input);
  if (!parsed.success) {
    throw new EvalPilotError(parsed.error.issues[0]?.message ?? '目标网址无效', 'INVALID_TARGET_URL');
  }
  return parsed.data;
}

export async function assertTargetReachable(
  targetUrl: string,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<void> {
  try {
    await fetchImplementation(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EvalPilotError(
      `目标网址当前不可访问：${targetUrl}。请先启动被测项目后重试。原始错误：${detail}`,
      'TARGET_UNREACHABLE',
    );
  }
}

export async function loadConfig(cwd: string, dataDir?: string): Promise<EvalPilotConfig> {
  const path = resolve(resolveDataRoot(cwd, dataDir), CONFIG_FILE);
  if (!(await pathExists(path))) {
    throw new EvalPilotError('当前目录尚未初始化 EvalPilot，请先运行 evalpilot init。', 'NOT_INITIALIZED');
  }

  let raw: unknown;
  try {
    raw = await readYamlFile(path);
  } catch (error) {
    throw new EvalPilotError(`无法读取配置文件：${String(error)}`, 'CONFIG_READ_FAILED');
  }

  const parsed = evalPilotConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EvalPilotError(`配置文件校验失败：${parsed.error.issues.map((issue) => issue.message).join('；')}`, 'CONFIG_INVALID');
  }
  return parsed.data;
}
