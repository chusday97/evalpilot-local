import type { InteractionAction } from '../../types.js';

export function analyzeEntryDiscovery(actions: InteractionAction[]): {
  found: boolean;
  timeToFindMs: number | null;
  attempts: number;
  evidence: string[];
} {
  const discovery = actions.find((action) => action.type === 'click' || (action.type === 'navigation' && action.timestampMs > 0));
  return {
    found: Boolean(discovery),
    timeToFindMs: discovery?.timestampMs ?? null,
    attempts: actions.filter((action) => action.type === 'click' || action.type === 'navigation').length,
    evidence: discovery?.evidence ?? [],
  };
}
