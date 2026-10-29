import { z } from 'zod';
import { UuidV7Schema } from '../common.ts';
import { AssayTypeKeySchema } from '../template.ts';

export const CreateExperimentBodySchema = z
  .strictObject({
    program_id: UuidV7Schema,
    assay_type: AssayTypeKeySchema,
    name: z.string().trim().min(1).max(200),
  })
  .meta({ id: 'CreateExperimentBody' });
export type CreateExperimentBody = z.infer<typeof CreateExperimentBodySchema>;

export const UpdateExperimentBodySchema = z
  .strictObject({ name: z.string().trim().min(1).max(200) })
  .meta({ id: 'UpdateExperimentBody' });
