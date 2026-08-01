import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { observePage } from '../../src/test-agent/observer.js';
import { browserFixturePages } from './pages.js';

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('known browser fixture pages', () => {
  it('exposes 11 reproducible clean, failure, boundary and safety states', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    expect(Object.keys(browserFixturePages)).toHaveLength(11);
    await page.setContent(browserFixturePages.happyPath); await page.getByRole('button', { name: 'Start' }).click(); expect(await page.getByRole('heading', { name: 'Done' }).isVisible()).toBe(true);
    await page.setContent(browserFixturePages.inputForm); await page.locator('input').fill('Fixture'); await page.getByRole('button', { name: 'Submit' }).click(); expect(await page.locator('main').getAttribute('data-submitted')).toBe('true');
    await page.setContent(browserFixturePages.deadClick); const before = await page.locator('body').innerText(); await page.getByRole('button', { name: 'Save' }).click(); expect(await page.locator('body').innerText()).toBe(before);
    await page.setContent(browserFixturePages.noFeedback); await page.getByRole('button', { name: 'Submit' }).click(); expect(await page.locator('body').innerText()).toContain('No feedback');
    await page.setContent(browserFixturePages.stateLoss); await page.getByRole('button', { name: 'Save' }).click(); await page.setContent(browserFixturePages.stateLoss); expect(await page.locator('body').getAttribute('data-saved')).toBeNull();
    await page.setContent(browserFixturePages.duplicateSubmit); await page.getByRole('button', { name: 'Submit' }).click(); expect(await page.evaluate(() => (window as typeof window & { requestCount?: number }).requestCount)).toBe(2);
    await page.setContent(browserFixturePages.timeout); await page.getByRole('button', { name: 'Generate' }).click(); await page.waitForTimeout(50); expect(await page.locator('body').getAttribute('data-done')).toBeNull();
    await page.route('**/fixture-api', (route) => route.fulfill({ status: 500, body: 'error' })); await page.setContent(browserFixturePages.network500); const response = page.waitForResponse('**/fixture-api'); await page.getByRole('button', { name: 'Load' }).click(); expect((await response).status()).toBe(500);
    await page.setContent(browserFixturePages.missingNextStep); expect(await page.getByRole('link').count()).toBe(0); expect(await page.getByRole('button').count()).toBe(0);
    await page.setContent(browserFixturePages.safeBoundary); await page.getByRole('button', { name: 'Continue' }).click(); expect(await page.locator('body').getAttribute('data-accepted')).toBe('empty');
    await page.setContent(browserFixturePages.destructiveButton); const observation = await observePage(page); expect(observation.interactableElements[0]).toMatchObject({ label: 'Delete account', risk: 'high' });
    await browser.close();
  });
});
