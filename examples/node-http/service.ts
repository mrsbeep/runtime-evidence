import { createServer, type Server } from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';

export interface ExampleService {
  readonly close: () => Promise<void>;
  readonly url: string;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        rejectPromise(error);
      }
    });
  });
}

export function startExampleService(version: number): Promise<ExampleService> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/version') {
        response.writeHead(404).end();
        return;
      }

      const body = JSON.stringify({ status: 'ok', version });
      response.writeHead(200, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
      });
      response.end(body);
    });

    server.once('error', rejectPromise);
    server.listen(0, LOOPBACK_HOST, () => {
      server.removeListener('error', rejectPromise);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        void closeServer(server).finally(() => {
          rejectPromise(new Error('Example service did not receive a TCP address.'));
        });
        return;
      }

      resolvePromise({
        close: () => closeServer(server),
        url: `http://${LOOPBACK_HOST}:${address.port}`,
      });
    });
  });
}
