// @ts-nocheck - Bun types not available in TSC context
await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  target: "node",
  minify: true,
  sourcemap: "external",
});

export {};
