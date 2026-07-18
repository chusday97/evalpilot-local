import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const port = Number(process.env.PORT ?? 4310);
createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  createReadStream(resolve(import.meta.dirname, 'index.html')).pipe(response);
}).listen(port, '127.0.0.1', () => process.stdout.write(`Static example: http://127.0.0.1:${port}\n`));
