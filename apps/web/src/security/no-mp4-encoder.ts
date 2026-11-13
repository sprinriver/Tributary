// Stands in for `h264-mp4-encoder` in the web build (vite.config.ts alias; Phase 40, SEC-01). Mol*'s viewer app
// imports its movie-export extension, whose Emscripten encoder builds functions with `new Function` as soon as it
// loads; the CSP blocks that. Tributary's 3D view offers no movie export, so the encoder is never needed.

export function createH264MP4Encoder(): Promise<never> {
  return Promise.reject(
    new Error(
      'Movie export is not available in Tributary: its encoder needs eval, which the security policy blocks.',
    ),
  );
}
