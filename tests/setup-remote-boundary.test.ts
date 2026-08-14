import { describe, expect, it } from 'vitest';
import { isBlockedRemoteWrite } from '../src/scenario/setup-runner.js';

describe('Safe Setup remote request boundary', () => {
  it('treats blocked read-only requests as non-mutating diagnostics', () => {
    expect(isBlockedRemoteWrite('GET https://ipapi.co/json/')).toBe(false);
    expect(isBlockedRemoteWrite('HEAD https://example.com/status')).toBe(false);
    expect(isBlockedRemoteWrite('OPTIONS https://example.com/api')).toBe(false);
  });

  it('keeps remote mutations as hard-write attempts', () => {
    expect(isBlockedRemoteWrite('POST https://example.com/api/setup')).toBe(true);
    expect(isBlockedRemoteWrite('PUT https://example.com/api/setup/1')).toBe(true);
    expect(isBlockedRemoteWrite('PATCH https://example.com/api/setup/1')).toBe(true);
    expect(isBlockedRemoteWrite('DELETE https://example.com/api/setup/1')).toBe(true);
  });
});
