import type { Page } from 'playwright';
import type { GroundedField } from '../../types.js';
import type { SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';

const groundedSelector = 'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]';

function extension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function acceptsFixture(accept: string, fixture: SyntheticFileFixture): boolean {
  const tokens = accept.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const mime = fixture.mimeType.toLowerCase();
  const ext = extension(fixture.filename);
  return tokens.some((token) => token === ext || token === mime || (token.endsWith('/*') && mime.startsWith(token.slice(0, -1))));
}

export async function chooseSyntheticFileFixture(page: Page, field: GroundedField, fixtures: SyntheticFileFixture[]): Promise<SyntheticFileFixture | null> {
  if (field.inputType !== 'file' || !fixtures.length) return null;
  const index = Number(field.locatorHint.split(':')[1]);
  if (!Number.isInteger(index) || index < 0) return null;
  const accept = (await page.locator(groundedSelector).filter({ visible: true }).nth(index).getAttribute('accept').catch(() => null)) ?? '';
  return fixtures.find((fixture) => acceptsFixture(accept, fixture)) ?? null;
}
