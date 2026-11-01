/**
 * True inside an iframe (e.g. a Hugging Face Space page), where browsers block the app's sign-in cookies as
 * third-party. A cross-origin parent can throw on access, which also means "embedded".
 */
export function isEmbedded(win: { self: unknown; top: unknown } = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}
