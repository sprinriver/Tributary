// Mol* without string evaluation (Phase 40, SEC-01). Mol* 5.11's mol-util/string.js `interpolate` builds a
// template literal with `new Function`, used only to put `${triggers}` into mouse-binding help (mol-util/binding.js).
// The production CSP has no 'unsafe-eval', so vite.config.ts swaps that one function, in the build and in the dev
// server's pre-bundle, for a plain placeholder substitution. A Mol* version without the expected code fails the build.

export const MOLSTAR_STRING_MODULE = /molstar[\\/]lib[\\/]mol-util[\\/]string\.js$/;

const START = 'export function interpolate(str, params) {';

/** Fills `${name}` placeholders; unknown names are left as they are. */
export function safeInterpolate(str: string, params: Record<string, unknown>): string {
  return str.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (match: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

// The same function as plain JavaScript, inserted into the Mol* module.
const REPLACEMENT = `export function interpolate(str, params) {
    return str.replace(/\\$\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}
`;

export function rewriteInterpolate(code: string): string {
  const start = code.indexOf(START);
  const end = start < 0 ? -1 : code.indexOf('\n}\n', start);
  if (start < 0 || end < 0 || !code.slice(start, end).includes('new Function'))
    throw new Error(
      'Mol* mol-util/string.js no longer has the expected interpolate(): review apps/web/src/security/molstar-no-eval.ts.',
    );
  return code.slice(0, start) + REPLACEMENT + code.slice(end + 3);
}

/** Vite / Rolldown plugin applying the rewrite. */
export const molstarNoEval = () => ({
  name: 'tributary-molstar-no-eval',
  transform(code: string, id: string) {
    return MOLSTAR_STRING_MODULE.test(id.split('?')[0]!)
      ? { code: rewriteInterpolate(code), map: null }
      : null;
  },
});
