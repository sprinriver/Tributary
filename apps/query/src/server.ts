import { buildApp } from './app.ts';

const port = Number(process.env.QUERY_PORT ?? 3100);
const host = process.env.QUERY_HOST ?? '127.0.0.1';

const app = await buildApp({ server: { logger: true } });
await app.listen({ port, host });
