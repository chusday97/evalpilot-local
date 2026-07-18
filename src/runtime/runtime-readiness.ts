import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import type { RuntimeCheck, RuntimeReadiness } from '../../types.js';
import { detectAgentConnections } from '../agents/agent-discovery.js';
import { packageVersion, resolveDataRoot } from './paths.js';

const exec = promisify(execFile);

function nodeCheck(): RuntimeCheck {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > 20 || (major === 20 && minor >= 19);
  return supported
    ? { status: 'ready', label: 'Node.js', detail: `Node.js ${process.versions.node} 可以运行 EvalPilot。`, recoveryAction: null }
    : { status: 'blocked', label: 'Node.js', detail: `当前为 Node.js ${process.versions.node}，EvalPilot 需要 20.19.0 或更高版本。`, recoveryAction: '升级 Node.js 后重新运行 evalpilot doctor。' };
}

function chromiumCheck(): RuntimeCheck {
  const executable = chromium.executablePath();
  return existsSync(executable)
    ? { status: 'ready', label: 'Chromium', detail: '评测浏览器已安装。', recoveryAction: null }
    : { status: 'missing', label: 'Chromium', detail: '评测浏览器尚未安装；Dashboard 仍可打开，但不能运行浏览器评测。', recoveryAction: '运行 evalpilot setup --install-chromium --confirmed。' };
}

async function gitCheck(): Promise<RuntimeCheck> {
  try {
    const result = await exec('git', ['--version'], { encoding: 'utf8', timeout: 4_000 });
    return { status: 'ready', label: 'Git', detail: result.stdout.trim(), recoveryAction: null };
  } catch {
    return { status: 'missing', label: 'Git', detail: '没有检测到 Git；评测仍可运行，但不能创建隔离修复分支。', recoveryAction: '安装 Git 后重新检查。' };
  }
}

export async function inspectRuntime(cwd: string, dataDir?: string | null): Promise<RuntimeReadiness> {
  const node = nodeCheck();
  const chromiumResult = chromiumCheck();
  const git = await gitCheck();
  const agents = await detectAgentConnections(false);
  const checks = { node, chromium: chromiumResult, git };
  const blockingIssues = Object.values(checks).filter((item) => item.status === 'blocked').map((item) => item.detail);
  const recoveryActions = [...new Set(Object.values(checks).flatMap((item) => item.recoveryAction ? [item.recoveryAction] : []))];
  return { packageVersion: packageVersion(), contractVersion: '0.5.0', platform: process.platform, nodeVersion: process.versions.node, dataRoot: resolveDataRoot(cwd, dataDir), checks, agents, blockingIssues, recoveryActions, checkedAt: new Date().toISOString() };
}
