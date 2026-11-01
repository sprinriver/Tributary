// Self-hosted deployments: creates the raw, warehouse and work buckets and allows browser uploads from PUBLIC_URL
// (S3 CORS). Idempotent; the deploy stack runs it before the API starts. On AWS, Terraform owns buckets and CORS.
import { loadConfig } from '../src/config.ts';
import { Storage } from '../src/storage.ts';

const config = loadConfig();
await new Storage(config.s3).ensureBucket([config.publicUrl]);
console.log(`setup-storage: buckets ready; uploads allowed from ${config.publicUrl}`);
