import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DocumentEvidence, DocumentItem, EvidenceClaim, RepositoryEvidence } from '../../types.js';

const preferredDocumentPattern = /(^|\/)(readme|docs?|prd|product|requirements?|architecture|security|roadmap|progress|handoff)([^/]*)\.(md|mdx|txt|rst)$/i;

export async function scanDocuments(repository: RepositoryEvidence): Promise<DocumentEvidence> {
  const documentFiles = repository.files
    .filter((file) => file.category === 'document' && preferredDocumentPattern.test(file.path))
    .slice(0, 200);
  const documents: DocumentItem[] = [];
  const claims: EvidenceClaim[] = [];

  for (const file of documentFiles) {
    const content = await readFile(resolve(repository.projectRoot, file.path), 'utf8');
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.path;
    const excerpt = content.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1_000);
    documents.push({ path: file.path, title, excerpt });
    claims.push({
      claim: `项目文档声明：${title}`,
      sourceType: 'document',
      source: file.path,
      status: 'declared',
    });
  }

  return { documents, claims, scannedAt: new Date().toISOString() };
}

