import { buildApp } from './app.ts';

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '127.0.0.1';

const app = buildApp({ server: { logger: true } });
await app.listen({ port, host });
