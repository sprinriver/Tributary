# Data and insights guide — source

`guide.html` is the source of `../Tributary-Data-and-Insights-Guide.pdf`. Screenshots are referenced as
`{{name.png}}` and live in `artifacts/guide/`.

To rebuild the PDF after editing:
1. `python -I artifacts/guide/source/embed.py artifacts/guide/source/guide.html artifacts/guide <out>.html`
   (inlines the screenshots; standard library only).
2. Open `<out>.html` in Chromium and print to PDF (A4, background graphics on), or use Playwright `page.pdf()`.

Screenshots come from a local instance with `pnpm db:seed` and `pnpm demo:data` (synthetic data only).
