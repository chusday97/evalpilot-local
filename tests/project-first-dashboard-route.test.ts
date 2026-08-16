import { describe, expect, it, vi } from 'vitest';
import { applyProjectFirstLanding, projectFirstLandingPath } from '../dashboard/src/project-first-route.js';

describe('project-first dashboard landing', () => {
  it('routes the bare dashboard root to Projects and preserves query/hash context', () => {
    expect(projectFirstLandingPath('/', '?source=preview', '#add')).toBe('/projects?source=preview#add');
    expect(projectFirstLandingPath('', '', '')).toBe('/projects');
  });

  it('does not override an explicit product page', () => {
    expect(projectFirstLandingPath('/evaluate')).toBeNull();
    expect(projectFirstLandingPath('/eval-set')).toBeNull();
    expect(projectFirstLandingPath('/runs')).toBeNull();
  });

  it('applies the landing route before React renders', () => {
    const replaceState = vi.fn();
    const changed = applyProjectFirstLanding(
      { pathname: '/', search: '', hash: '' } as Location,
      { replaceState } as unknown as History,
    );

    expect(changed).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({}, '', '/projects');
  });

  it('leaves explicit routes untouched', () => {
    const replaceState = vi.fn();
    const changed = applyProjectFirstLanding(
      { pathname: '/findings', search: '?projectId=p1', hash: '' } as Location,
      { replaceState } as unknown as History,
    );

    expect(changed).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
