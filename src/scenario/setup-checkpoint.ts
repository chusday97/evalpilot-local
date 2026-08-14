import { createHash } from 'node:crypto';
import type { BrowserContext } from 'playwright';
import type { SanitizedAuthStorageState } from './auth-session-fixture.js';
import type { AutoSetupPlan } from './setup-resolver.js';

export interface VerifiedSetupCheckpoint {
  checkpointId: string;
  taskId: string;
  targetOrigin: string;
  authScopeKey: string;
  storageState: SanitizedAuthStorageState;
  sourceRunId: string;
  capturedAt: string;
}

export interface SetupCheckpointResolution {
  checkpoint: VerifiedSetupCheckpoint | null;
  satisfiedSetupCount: number;
  remainingSetupPlans: AutoSetupPlan[];
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function cookieMatchesHost(domainValue: string, hostValue: string): boolean {
  const domain = domainValue.trim().replace(/^\./, '').toLowerCase();
  const host = hostValue.toLowerCase();
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

export function checkpointAuthScopeKey(storageState: SanitizedAuthStorageState | null): string {
  if (!storageState) return 'anonymous';
  return `auth-${createHash('sha256').update(JSON.stringify(storageState)).digest('hex').slice(0, 16)}`;
}

export async function captureVerifiedSetupCheckpoint(input: {
  context: BrowserContext;
  taskId: string;
  targetUrl: string;
  authScopeKey: string;
  sourceRunId: string;
  capturedAt?: string;
}): Promise<VerifiedSetupCheckpoint | null> {
  const target = new URL(input.targetUrl);
  if (!isLoopbackHost(target.hostname)) return null;

  const raw = await input.context.storageState();
  const cookies = raw.cookies
    .filter((cookie) => cookieMatchesHost(cookie.domain, target.hostname))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
  const origins = raw.origins
    .filter((origin) => {
      try { return new URL(origin.origin).origin === target.origin; }
      catch { return false; }
    })
    .map((origin) => ({
      origin: origin.origin,
      localStorage: origin.localStorage.map((entry) => ({ name: entry.name, value: entry.value })),
    }));

  if (!cookies.length && !origins.some((origin) => origin.localStorage.length > 0)) return null;
  const storageState: SanitizedAuthStorageState = { cookies, origins };
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  return {
    checkpointId: `checkpoint-${input.taskId}-${input.sourceRunId}`,
    taskId: input.taskId,
    targetOrigin: target.origin,
    authScopeKey: input.authScopeKey,
    storageState,
    sourceRunId: input.sourceRunId,
    capturedAt,
  };
}

export function resolveSetupCheckpoint(input: {
  setupPlans: AutoSetupPlan[];
  checkpoints: ReadonlyMap<string, VerifiedSetupCheckpoint>;
  targetUrl: string;
  authScopeKey: string;
}): SetupCheckpointResolution {
  const targetOrigin = new URL(input.targetUrl).origin;
  for (let index = input.setupPlans.length - 1; index >= 0; index -= 1) {
    const plan = input.setupPlans[index]!;
    const checkpoint = input.checkpoints.get(plan.setupTaskId) ?? null;
    if (!checkpoint) continue;
    if (checkpoint.targetOrigin !== targetOrigin || checkpoint.authScopeKey !== input.authScopeKey) continue;
    return {
      checkpoint,
      satisfiedSetupCount: index + 1,
      remainingSetupPlans: input.setupPlans.slice(index + 1),
    };
  }
  return { checkpoint: null, satisfiedSetupCount: 0, remainingSetupPlans: [...input.setupPlans] };
}

export function chainPlanForRemaining(caseId: string, setupPlans: AutoSetupPlan[]): (AutoSetupPlan & { chainSteps?: AutoSetupPlan[] }) | null {
  if (!setupPlans.length) return null;
  if (setupPlans.length === 1) return setupPlans[0]!;
  const final = setupPlans.at(-1)!;
  return {
    ...final,
    setupId: `setup-chain-resume-${caseId}`,
    reason: `从 verified checkpoint 后继续执行 ${setupPlans.length} 个 Setup 步骤。`,
    chainSteps: setupPlans,
  };
}
