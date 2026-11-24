import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MOLSTAR_STRING_MODULE, rewriteInterpolate, safeInterpolate } from './molstar-no-eval.ts';

// Mol* 5.11 formats its mouse-binding help with `new Function` (mol-util/string.js interpolate), which a CSP
// without 'unsafe-eval' blocks. The build swaps that one function for a plain placeholder substitution.
const require = createRequire(import.meta.url);
const file = require.resolve('molstar/lib/mol-util/string.js');

describe('Mol* without eval', () => {
  it('SEC-01: the installed Mol* string module is matched and rewritten without any string evaluation', () => {
    expect(MOLSTAR_STRING_MODULE.test(file)).toBe(true);
    const original = readFileSync(file, 'utf8');
    expect(original).toContain('new Function');
    const rewritten = rewriteInterpolate(original);
    expect(rewritten).not.toContain('new Function');
    expect(rewritten).toContain('export function interpolate(str, params)');
    // Everything else in the module is unchanged.
    expect(rewritten.replace(/export function interpolate[\s\S]*?\n}\n/, '')).toBe(
      original.replace(/export function interpolate[\s\S]*?\n}\n/, ''),
    );
  });

  it('SEC-01: a Mol* upgrade that changes the function fails the build instead of shipping eval', () => {
    expect(() => rewriteInterpolate('export function interpolate(a) { return a; }\n')).toThrow(/Mol\*/);
  });

  it('SEC-01: the replacement fills ${name} placeholders as the template literal did', () => {
    expect(safeInterpolate('Click element using ${triggers}', { triggers: '<i>Left</i>' })).toBe(
      'Click element using <i>Left</i>',
    );
    expect(safeInterpolate('${a} and ${ b }, ${c}', { a: 1, b: 'two' })).toBe('1 and two, ${c}');
    expect(safeInterpolate('no placeholders', {})).toBe('no placeholders');
  });
});
