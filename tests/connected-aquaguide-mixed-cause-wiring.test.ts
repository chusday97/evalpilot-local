import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('connected AquaGuide mixed-cause diagnostic wiring', () => {
  it('keeps the terminal runtime failure separate from earlier action execution signals', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');

    expect(source).toContain('evidencePacketSchema.parse');
    expect(source).toContain('collectObservedPreFailureSignals');
    expect(source).toContain('runtimeFailureSource,');
    expect(source).toContain('observedPreFailureSignals,');
    expect(source).toContain('observedPreFailureSignalCount');
    expect(source).toContain('schemaVersion: 3');
    expect(source).toContain('preFailureSignalSidecar: true');
    expect(source).toContain('these sidecar signals do not override the terminal runtime failure');
  });

  it('does not turn a recoverable action failure into a protocol-health failure by itself', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');
    const protocolHealthStart = source.indexOf('const protocolHealthy =');
    const diagnosticStart = source.indexOf('const diagnostic =', protocolHealthStart);
    const protocolHealthExpression = source.slice(protocolHealthStart, diagnosticStart);

    expect(protocolHealthExpression).toContain('providerFailureCount === 0');
    expect(protocolHealthExpression).toContain('evaluatorFailureCount === 0');
    expect(protocolHealthExpression).not.toContain('observedPreFailureSignalCount === 0');
  });
});
