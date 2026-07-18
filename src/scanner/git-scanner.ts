import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitEvidence } from '../../types.js';

const execFileAsync = promisify(execFile);

async function git(projectRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', projectRoot, ...args], { encoding: 'utf8', maxBuffer: 2_000_000 });
  return result.stdout.trim();
}

export async function scanGit(projectRoot: string): Promise<GitEvidence> {
  const scannedAt = new Date().toISOString();
  try {
    const branch = (await git(projectRoot, ['branch', '--show-current'])) || null;
    const log = await git(projectRoot, ['log', '--format=%h%x09%s', '-20']);
    const status = await git(projectRoot, ['status', '--short']);
    return {
      available: true,
      branch,
      commits: log
        ? log.split('\n').map((line) => {
            const [hash = '', ...subject] = line.split('\t');
            return { hash, subject: subject.join('\t') };
          })
        : [],
      changedFiles: status ? status.split('\n') : [],
      scannedAt,
    };
  } catch {
    return { available: false, branch: null, commits: [], changedFiles: [], scannedAt };
  }
}

