import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AQUAGUIDE_PUI_BC_023_BOUNDARY_CHALLENGE_ID,
  AQUAGUIDE_PUI_BC_023_JOURNEY_CHALLENGE_ID,
  AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID,
  AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID,
  buildAquaGuidePuiBc023ChallengeAnalysis,
  selectAquaGuidePuiBc023NextChallenge,
} from '../src/validation/aquaguide-pui-bc-023-challenges.js';

describe('AquaGuide PUI-BC-023 challenge expansion', () => {
  it('selects the intended coverage gap even when the source case has sparse coverage dimensions', () => {
    const analysis = buildAquaGuidePuiBc023ChallengeAnalysis();
    expect(analysis.challengeCandidates).toHaveLength(3);

    const byId = new Map(analysis.challengeCandidates.map((item) => [item.caseId, item]));
    expect(byId.get(AQUAGUIDE_PUI_BC_023_BOUNDARY_CHALLENGE_ID)?.coverageDimensions).toContainEqual({ dimension: 'input_quality', value: 'boundary' });
    expect(byId.get(AQUAGUIDE_PUI_BC_023_JOURNEY_CHALLENGE_ID)?.coverageDimensions).toContainEqual({ dimension: 'journey_stage', value: 'backtrack' });
    expect(byId.get(AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID)?.coverageDimensions).toContainEqual({ dimension: 'persona', value: AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID });
    expect(byId.get(AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID)?.persona.personaId).toBe(AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID);
  });

  it('keeps all generated Challenge assets as unexecuted candidates rather than inheriting the source PASS', () => {
    const analysis = buildAquaGuidePuiBc023ChallengeAnalysis();
    for (const candidate of analysis.challengeCandidates) {
      expect(candidate.setType).toBe('challenge');
      expect(candidate.status).toBe('candidate');
      expect(candidate.stats).toMatchObject({ passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, lastExecutedAt: null });
      expect(candidate.origin.type).toBe('generated_from_coverage_gap');
    }
  });

  it('prioritizes the low-patience persona candidate without claiming it has run', async () => {
    const selected = selectAquaGuidePuiBc023NextChallenge();
    const snapshot = JSON.parse(await readFile('acceptance/real-products/aquaguide-pui-bc-023-challenges.json', 'utf8'));

    expect(selected.caseId).toBe(AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID);
    expect(selected.persona).toMatchObject({ personaId: AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID, patienceTurns: 1, retryTolerance: 0 });
    expect(snapshot.selectedNextCandidateId).toBe(selected.caseId);
    expect(snapshot.executionStatus).toBe('candidate_not_run');
    expect(snapshot.claimBoundary).toContain('Challenge candidates are generated from a trusted PASS but have not themselves been executed.');
    expect(snapshot.claimBoundary).toContain('No paid connected Challenge run is authorized by this artifact.');
  });
});
