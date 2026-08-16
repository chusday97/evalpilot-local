import { describe, expect, it } from 'vitest';
import { partitionNetworkFailuresForPage } from '../src/test-agent/network-failure-boundary.js';

describe('network hard-failure boundary', () => {
  it('keeps same-origin request failures as deterministic core failures', () => {
    expect(partitionNetworkFailuresForPage([
      '500 http://127.0.0.1:3000/api/ai/chat',
      '404 http://127.0.0.1:3000/api/missing',
    ], 'http://127.0.0.1:3000/aquarium?action=daily-check')).toEqual({
      hardFailures: [
        '500 http://127.0.0.1:3000/api/ai/chat',
        '404 http://127.0.0.1:3000/api/missing',
      ],
      nonCoreFailures: [],
    });
  });

  it('does not let a third-party 429 deterministically fail the product task', () => {
    expect(partitionNetworkFailuresForPage([
      '429 https://ipapi.co/json/',
      '500 http://127.0.0.1:3000/api/ai/chat',
    ], 'http://127.0.0.1:3000/aquarium?action=daily-check')).toEqual({
      hardFailures: ['500 http://127.0.0.1:3000/api/ai/chat'],
      nonCoreFailures: ['429 https://ipapi.co/json/'],
    });
  });

  it('treats different ports and malformed URLs as non-core without deleting their evidence', () => {
    expect(partitionNetworkFailuresForPage([
      '503 http://127.0.0.1:4173/api',
      '500 not-a-url',
    ], 'http://127.0.0.1:3000/aquarium')).toEqual({
      hardFailures: [],
      nonCoreFailures: [
        '503 http://127.0.0.1:4173/api',
        '500 not-a-url',
      ],
    });
  });
});
