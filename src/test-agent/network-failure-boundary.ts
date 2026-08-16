export interface NetworkFailureBoundaryResult {
  hardFailures: string[];
  nonCoreFailures: string[];
}

function failureUrl(failure: string): URL | null {
  const match = /^\d{3}\s+(.+)$/.exec(failure.trim());
  if (!match) return null;
  try { return new URL(match[1]!); }
  catch { return null; }
}

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * AgentRunner records document/xhr/fetch HTTP failures as candidate core failures so the raw
 * network evidence stays complete. Deterministic TaskState failure is intentionally stricter:
 * only requests on the currently tested application origin are hard product evidence.
 *
 * Cross-origin APIs can still be first-party in some architectures, but EvalPilot cannot prove
 * that from a URL alone. Treating every third-party telemetry/geolocation/CDN failure as a hard
 * product failure creates false positives. Those failures remain available to semantic
 * verification and evidence packets instead of disappearing.
 */
export function partitionNetworkFailuresForPage(failures: string[], pageUrl: string): NetworkFailureBoundaryResult {
  const pageOrigin = httpOrigin(pageUrl);
  const hardFailures: string[] = [];
  const nonCoreFailures: string[] = [];
  for (const failure of failures) {
    const url = failureUrl(failure);
    if (pageOrigin && url && url.origin === pageOrigin) hardFailures.push(failure);
    else nonCoreFailures.push(failure);
  }
  return {
    hardFailures: [...new Set(hardFailures)],
    nonCoreFailures: [...new Set(nonCoreFailures)],
  };
}
