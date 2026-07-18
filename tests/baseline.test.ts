import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('project baseline', () => {
  it('declares the expected package and Node baseline', async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      name: string;
      engines: { node: string };
      bin: { evalpilot: string };
    };

    expect(packageJson.name).toBe('evalpilot-local');
    expect(packageJson.engines.node).toBe('>=20.19.0');
    expect(packageJson.bin.evalpilot).toBe('dist/src/cli/index.js');
  });

  it.each([
    'README.md',
    'CONTRACT.md',
    'types.ts',
    'ARCHITECTURE.md',
    'SECURITY.md',
    'ROADMAP.md',
  ])('contains required baseline file %s', async (file) => {
    await expect(access(resolve(root, file))).resolves.toBeUndefined();
  });
});
