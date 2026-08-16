import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_CHUNK_BYTES = 500 * 1024;
const assetsDirectory = resolve("dist/assets");
const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((assetName) => assetName.endsWith(".js"));

if (javascriptAssets.length === 0) {
  throw new Error(`No JavaScript bundles found in ${assetsDirectory}`);
}

const oversizedAssets = [];

for (const assetName of javascriptAssets) {
  const assetPath = resolve(assetsDirectory, assetName);
  const { size } = await stat(assetPath);

  if (size > MAX_CHUNK_BYTES) {
    oversizedAssets.push(`${assetName} (${(size / 1024).toFixed(1)} KiB)`);
  }
}

if (oversizedAssets.length > 0) {
  throw new Error(
    `JavaScript chunk limit exceeded (${MAX_CHUNK_BYTES / 1024} KiB): ${oversizedAssets.join(", ")}`,
  );
}

console.log(
  `Bundle size gate passed: ${javascriptAssets.length} JavaScript chunks are at or below ${MAX_CHUNK_BYTES / 1024} KiB.`,
);
