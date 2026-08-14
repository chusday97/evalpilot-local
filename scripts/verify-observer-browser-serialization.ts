import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { observePage } from '../src/test-agent/observer.js';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body><main>
    <h1>Aquarium Settings</h1>
    <label>Length (cm)<input name="length" type="number" min="10" max="300"></label>
    <label>Width (cm)<input name="width" type="number" min="10" max="200"></label>
    <label>Height (cm)<input name="height" type="number" min="10" max="200"></label>
    <label>Water type<select name="waterType"><option value="freshwater">Freshwater</option><option value="saltwater">Saltwater</option></select></label>
    <button>Save Settings</button>
  </main></body></html>`);
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
  const observation = await observePage(page, [], 'observer-serialization-check');
  const length = observation.formFields.find((field) => field.fieldName === 'length');
  const waterType = observation.formFields.find((field) => field.fieldName === 'waterType');
  if (!length) throw new Error(`Observer missing labeled number input: ${JSON.stringify(observation.formFields)}`);
  if (!length.label.includes('Length (cm)')) throw new Error(`Observer lost input label: ${length.label}`);
  if (length.inputType !== 'number') throw new Error(`Observer input type mismatch: ${length.inputType}`);
  if (!waterType) throw new Error(`Observer missing select field: ${JSON.stringify(observation.formFields)}`);
  if (!waterType.options.includes('freshwater') || !waterType.options.includes('Freshwater')) {
    throw new Error(`Observer lost select options: ${JSON.stringify(waterType.options)}`);
  }

  await page.setContent(`<!doctype html><html><body>
    <button id="background-action">Background action</button>
    <div data-open="" data-slot="dialog-overlay" role="presentation" style="position:fixed;inset:0"></div>
    <div role="dialog" aria-modal="true" style="position:fixed;inset:40px;background:white">
      <p>Saved successfully</p>
      <button id="continue">Continue recording</button>
      <button id="close" onclick="document.body.dataset.closed='1'">Close</button>
    </div>
  </body></html>`);
  const modalObservation = await observePage(page, [], 'observer-modal-grounding-check');
  const labels = modalObservation.interactableElements.map((element) => element.label);
  if (labels.includes('Background action')) throw new Error(`Observer exposed a background control through a modal overlay: ${JSON.stringify(labels)}`);
  if (!labels.includes('Continue recording') || !labels.includes('Close')) throw new Error(`Observer lost modal controls: ${JSON.stringify(labels)}`);
  if (modalObservation.visibleStateSummary.includes('Background action')) throw new Error(`Observer mixed background text into blocking modal state: ${modalObservation.visibleStateSummary}`);
  const close = modalObservation.interactableElements.find((element) => element.label === 'Close');
  if (!close) throw new Error('Observer did not expose modal Close action.');
  const closeIndex = Number(close.locatorHint.split(':')[1]);
  await page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').filter({ visible: true }).nth(closeIndex).click();
  const closed = await page.evaluate(() => document.body.dataset.closed === '1');
  if (!closed) throw new Error(`Modal locator hint resolved to the wrong global DOM element: ${close.locatorHint}`);

  process.stdout.write('Observer browser serialization + modal grounding: PASS\n');
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
