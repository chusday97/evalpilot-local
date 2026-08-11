import { z } from 'zod';
import { badcaseSchema } from '../badcase/schemas.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { candidateFindingSchema } from '../findings/schemas.js';
import { uxIssueSchema } from '../schemas/ux-evaluation.js';

const capturedAtSchema = z.iso.datetime();

export const fixSourceSnapshotSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('evaluation_issue'), evaluationId: storageIdSchema, issueId: storageIdSchema, findingId: z.null(), badcaseId: z.null(), capturedAt: capturedAtSchema, payload: uxIssueSchema }).strict(),
  z.object({ sourceType: z.literal('confirmed_finding'), evaluationId: z.null(), issueId: z.null(), findingId: storageIdSchema, badcaseId: z.null(), capturedAt: capturedAtSchema, payload: candidateFindingSchema }).strict(),
  z.object({ sourceType: z.literal('badcase'), evaluationId: z.null(), issueId: z.null(), findingId: z.null(), badcaseId: storageIdSchema, capturedAt: capturedAtSchema, payload: badcaseSchema }).strict(),
]);
