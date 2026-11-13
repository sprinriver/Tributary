// Imported first by main.tsx (Phase 40, SEC-01). zod 4 compiles fast object parsers with `new Function` when eval is
// allowed and probes for it once; under the CSP (no 'unsafe-eval') the probe is reported as a violation. jitless
// turns both off: zod then uses its plain parsers.
import { z } from 'zod';

z.config({ jitless: true });
