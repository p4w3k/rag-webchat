// Bundles the widget into one self-contained script: dist/widget.js
import { build, buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

const options = (outfile) => ({
  entryPoints: [path.join(here, "src/index.ts")],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  legalComments: "none",
  logLevel: "warning",
});

export async function buildWidget(outfile = path.join(here, "dist/widget.js")) {
  await build(options(outfile));
  return outfile;
}

/** Synchronous variant for CDK synth, which cannot await. */
export function buildWidgetSync(outfile) {
  buildSync(options(outfile));
  return outfile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildWidget(process.argv[2]);
  console.log(`built ${out}`);
}
