// Test helper: a throwaway SeaweedFS S3 server (same image and credentials as docker-compose.yml).
import { GenericContainer, Wait } from 'testcontainers';

export const SEAWEEDFS_IMAGE = 'chrislusf/seaweedfs:4.51';
export const TEST_S3_CREDENTIALS = { accessKeyId: 'tributary-dev', secretAccessKey: 'tributary-dev-secret' };

const S3_CONFIG = JSON.stringify({
  identities: [
    {
      name: 'tributary',
      credentials: [
        { accessKey: TEST_S3_CREDENTIALS.accessKeyId, secretKey: TEST_S3_CREDENTIALS.secretAccessKey },
      ],
      actions: ['Admin', 'Read', 'List', 'Tagging', 'Write'],
    },
  ],
});

export interface TestS3 {
  endpoint: string;
  stop: () => Promise<void>;
}

export async function startTestS3(): Promise<TestS3> {
  const container = await new GenericContainer(SEAWEEDFS_IMAGE)
    .withCommand(['server', '-dir=/data', '-s3', '-s3.port=8333', '-s3.config=/etc/seaweedfs/s3.json'])
    .withCopyContentToContainer([{ content: S3_CONFIG, target: '/etc/seaweedfs/s3.json' }])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/healthz', 8333).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
