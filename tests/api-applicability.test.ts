import { describe, expect, it } from 'vitest';
import { statusForUntriggeredApiFault } from '../src/runner/scenario-runner.js';

describe('API fault applicability', () => {
  it('skips only when scanning explicitly found no business API', () => {
    expect(statusForUntriggeredApiFault('none')).toBe('not_applicable');
    expect(statusForUntriggeredApiFault('declared')).toBe('blocked');
    expect(statusForUntriggeredApiFault('unknown')).toBe('blocked');
  });
});
