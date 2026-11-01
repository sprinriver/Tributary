import { TOOLS } from './tools.ts';
import { WRITE_AND_CURATION_TOOLS } from './tools-write.ts';

/** The one tool registry (SPEC §11.2), shared by the assistant and, from Phase 20, the MCP server. */
export const REGISTRY = [...TOOLS, ...WRITE_AND_CURATION_TOOLS];
export const toolByName = (name: string) => REGISTRY.find((t) => t.name === name);
