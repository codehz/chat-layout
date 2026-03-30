import { $ } from "bun";
import { cp, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

await $`tsdown`;

for (const file of ["LICENSE", "README.md"]) {
  await cp(file, `dist/${file}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf-8")) as Record<string, unknown>;
delete packageJson.private;
delete packageJson.scripts;
delete packageJson.devDependencies;

const version = (await $`git describe --tags --always`
  .text()
  .catch(() => "0.0.0"))
  .trim()
  .replace(/-[0-9]+-g/, "+")
  .replace(/^v/, "");

packageJson.version = version;
packageJson.type = "module";
packageJson.main = "./index.mjs";
packageJson.module = "./index.mjs";
packageJson.types = "./index.d.mts";
packageJson.exports = {
  ".": {
    import: "./index.mjs",
    types: "./index.d.mts",
  },
};

await Bun.write("dist/package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
