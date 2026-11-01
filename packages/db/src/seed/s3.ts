import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where fixture files are staged (ARCHITECTURE §5 layout). Local defaults match docker-compose.yml. */
export interface StagingTarget {
  client: S3Client;
  bucket: string;
}

export function localStagingTarget(): StagingTarget {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'tributary-dev',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'tributary-dev-secret',
    },
  });
  return { client, bucket: process.env.S3_RAW_BUCKET ?? 'tributary-raw' };
}

export async function ensureBucket({ client, bucket }: StagingTarget): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

/** Uploads one fixture file; returns the object version id when the bucket is versioned. */
export async function stageFile(
  target: StagingTarget,
  fixturesDir: string,
  relativePath: string,
  key: string,
  sha256: string,
): Promise<string | null> {
  const result = await target.client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: key,
      Body: readFileSync(join(fixturesDir, relativePath)),
      Metadata: { sha256 },
    }),
  );
  return result.VersionId ?? null;
}
