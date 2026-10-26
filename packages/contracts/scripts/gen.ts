// `pnpm gen` step 1: writes packages/contracts/generated/{openapi.json,json-schema/*.json} from the zod contracts.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildArtifacts, GENERATED_DIR } from '../src/gen/artifacts.ts';

rmSync(GENERATED_DIR, { recursive: true, force: true });
const { files } = buildArtifacts();
for (const [path, content] of Object.entries(files)) {
  const target = join(GENERATED_DIR, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
console.log(`gen: wrote ${Object.keys(files).length} files to packages/contracts/generated`);
