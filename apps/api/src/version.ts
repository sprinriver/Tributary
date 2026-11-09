/** The product version (health, instance info, MCP server info, support bundle). 2.0.0 is released; this is next. */
export const API_VERSION = '2.1.0-dev';
/** The build deployed (e.g. the git commit), when the deployment sets APP_BUILD. */
export const APP_BUILD = process.env.APP_BUILD ?? null;
