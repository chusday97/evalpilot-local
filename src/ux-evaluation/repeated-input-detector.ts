import type { InteractionAction } from '../../types.js';

export function repeatedInputActionIds(actions: InteractionAction[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const action of actions) {
    if (action.type !== 'input' || !action.inputField || !action.inputFingerprint) continue;
    const key = `${action.inputField}:${action.inputFingerprint}`;
    if (seen.has(key)) repeated.push(action.actionId);
    seen.add(key);
  }
  return repeated;
}
