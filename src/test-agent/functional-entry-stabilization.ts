import type { Page } from 'playwright';
import type { AgentDecision } from '../../types.js';
import { captureTaskStateSignals, type TaskStateSignalSnapshot } from './task-state-signals.js';

export interface FunctionalEntryStabilizationPolicy {
  networkIdleTimeoutMs: number;
  hardTimeoutMs: number;
  pollIntervalMs: number;
  quietPollsRequired: number;
}

export interface FunctionalEntryStabilizationResult {
  schemaVersion: 1;
  mode: 'functional_entry_stabilization';
  requestedUrl: string;
  finalUrl: string;
  navigationPerformed: boolean;
  networkIdleObserved: boolean;
  domChangedDuringStabilization: boolean;
  loadingObserved: boolean;
  initialNodeCount: number;
  finalNodeCount: number;
  initialVisibleTextLength: number;
  finalVisibleTextLength: number;
  polls: number;
  elapsedMs: number;
  reason: 'network_idle_and_dom_quiet' | 'dom_quiet_after_network_timeout' | 'hard_timeout';
}

const defaultPolicy: FunctionalEntryStabilizationPolicy = {
  networkIdleTimeoutMs: 2_500,
  hardTimeoutMs: 4_000,
  pollIntervalMs: 100,
  quietPollsRequired: 4,
};

const waitDecision: AgentDecision = {
  decisionId: 'functional-entry-stabilization',
  intentSummary: '等待 Functional 起始页面完成应用初始化',
  action: 'wait',
  targetElementId: null,
  value: null,
  expectedResult: '页面初始化状态收敛',
  confidence: 1,
};

function stableFingerprint(snapshot: TaskStateSignalSnapshot): string {
  return JSON.stringify({
    visibleText: snapshot.visibleText,
    nodeCount: snapshot.nodeCount,
    loadingSignals: snapshot.loadingSignals,
    statusTexts: snapshot.statusTexts,
    progressValues: snapshot.progressValues,
    failureSignals: snapshot.failureSignals,
  });
}

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Functional evaluation answers whether a known task works from a prepared entry state. SPA
 * hydration is evaluator-managed startup, not a user action, so the Functional Actor should not
 * be asked to interpret a transient first render while route effects/local state are still
 * settling. Blind Experience deliberately does NOT call this helper because loading/discovery
 * friction belongs in the Blind journey evidence.
 *
 * Navigation is deliberately conservative. If Setup/tests already prepared the requested page,
 * do not reload it and destroy in-memory or same-route state. Only navigate when the current page
 * differs from an explicit http(s) starting URL. Synthetic `about:blank`/`data:` fixtures are
 * stabilized in place.
 *
 * This is bounded and signal-driven: wait for network-idle when available, then require several
 * consecutive DOM/task-signal polls to be quiet. A timeout never becomes PASS or Product FAIL;
 * it simply hands the latest real page state to the Functional Actor and records what happened.
 */
export async function stabilizeFunctionalEntry(
  page: Page,
  startingUrl: string,
  override: Partial<FunctionalEntryStabilizationPolicy> = {},
): Promise<FunctionalEntryStabilizationResult> {
  const policy = { ...defaultPolicy, ...override };
  const startedAt = performance.now();
  const navigationPerformed = page.url() !== startingUrl && isWebUrl(startingUrl);
  if (navigationPerformed) await page.goto(startingUrl, { waitUntil: 'domcontentloaded' });
  const initial = await captureTaskStateSignals(page, waitDecision);
  let previous = initial;
  let previousFingerprint = stableFingerprint(initial);
  let domChangedDuringStabilization = false;
  let loadingObserved = initial.loadingSignals.length > 0;
  let networkIdleObserved = false;
  let polls = 0;

  try {
    await page.waitForLoadState('networkidle', { timeout: policy.networkIdleTimeoutMs });
    networkIdleObserved = true;
  } catch {
    // Persistent/third-party network activity must not block Functional evaluation forever.
    // DOM/task-signal quiescence below remains the fallback boundary.
  }

  let quietPolls = 0;
  let current = await captureTaskStateSignals(page, waitDecision);
  while (performance.now() - startedAt < policy.hardTimeoutMs) {
    const currentFingerprint = stableFingerprint(current);
    loadingObserved ||= current.loadingSignals.length > 0;
    if (currentFingerprint === previousFingerprint && current.loadingSignals.length === 0) quietPolls += 1;
    else {
      if (currentFingerprint !== previousFingerprint) domChangedDuringStabilization = true;
      quietPolls = 0;
    }
    previous = current;
    previousFingerprint = currentFingerprint;
    if (quietPolls >= policy.quietPollsRequired) {
      const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
      return {
        schemaVersion: 1,
        mode: 'functional_entry_stabilization',
        requestedUrl: startingUrl,
        finalUrl: page.url(),
        navigationPerformed,
        networkIdleObserved,
        domChangedDuringStabilization,
        loadingObserved,
        initialNodeCount: initial.nodeCount,
        finalNodeCount: current.nodeCount,
        initialVisibleTextLength: initial.visibleTextLength,
        finalVisibleTextLength: current.visibleTextLength,
        polls,
        elapsedMs,
        reason: networkIdleObserved ? 'network_idle_and_dom_quiet' : 'dom_quiet_after_network_timeout',
      };
    }
    await page.waitForTimeout(policy.pollIntervalMs);
    polls += 1;
    current = await captureTaskStateSignals(page, waitDecision);
  }

  const final = await captureTaskStateSignals(page, waitDecision);
  if (stableFingerprint(final) !== stableFingerprint(previous)) domChangedDuringStabilization = true;
  loadingObserved ||= final.loadingSignals.length > 0;
  return {
    schemaVersion: 1,
    mode: 'functional_entry_stabilization',
    requestedUrl: startingUrl,
    finalUrl: page.url(),
    navigationPerformed,
    networkIdleObserved,
    domChangedDuringStabilization,
    loadingObserved,
    initialNodeCount: initial.nodeCount,
    finalNodeCount: final.nodeCount,
    initialVisibleTextLength: initial.visibleTextLength,
    finalVisibleTextLength: final.visibleTextLength,
    polls,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    reason: 'hard_timeout',
  };
}
