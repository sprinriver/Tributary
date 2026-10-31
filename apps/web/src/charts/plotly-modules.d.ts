// plotly.js ships no TypeScript types; these cover the partial-bundle modules we import.
declare module 'plotly.js/lib/core' {
  const Plotly: {
    register(modules: unknown[]): void;
    react(el: HTMLElement, data: unknown[], layout: unknown, config?: unknown): Promise<HTMLElement>;
    purge(el: HTMLElement): void;
    downloadImage(
      el: HTMLElement,
      options: { format: 'png' | 'svg'; filename: string; width?: number; height?: number },
    ): Promise<string>;
  };
  export default Plotly;
}
declare module 'plotly.js/lib/scatter' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/scattergl' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/heatmap' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/bar' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/box' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/histogram' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/pie' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/scatter3d' {
  const trace: unknown;
  export default trace;
}
declare module 'plotly.js/lib/violin' {
  const trace: unknown;
  export default trace;
}
