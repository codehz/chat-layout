import { $ } from "bun";
import { basename, join } from "node:path";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const sourceModuleFilePattern = /\.[cm]?[jt]sx?$/;

function rewriteRootImports(source: string, packageName: string): string {
  return source
    .replaceAll(
      /(\bfrom\s*|\bimport\s*\()\s*(["'])\.\.\/?\2/g,
      `$1$2${packageName}$2`,
    )
    .replaceAll(/(\bimport\s*)(["'])\.\.\/?\2/g, `$1$2${packageName}$2`);
}

async function copyExampleFiles(
  sourceDir: string,
  targetDir: string,
  packageName: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    if (entry.name === "build") {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyExampleFiles(sourcePath, targetPath, packageName);
      continue;
    }

    if (sourceModuleFilePattern.test(entry.name)) {
      const source = await readFile(sourcePath, "utf-8");
      await writeFile(targetPath, rewriteRootImports(source, packageName));
      continue;
    }

    await cp(sourcePath, targetPath);
  }
}

await rm("dist", { recursive: true, force: true });

await $`tsdown`;

for (const file of ["LICENSE", "README.md"]) {
  await cp(file, `dist/${file}`);
}

const packageJson = JSON.parse(
  await readFile("package.json", "utf-8"),
) as Record<string, unknown>;
const packageName = String(packageJson.name ?? basename(process.cwd()));
delete packageJson.private;
delete packageJson.scripts;
delete packageJson.devDependencies;

const version = (
  await $`git describe --tags --always`.text().catch(() => "0.0.0")
)
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

await Bun.write(
  "dist/package.json",
  `${JSON.stringify(packageJson, null, 2)}\n`,
);
await copyExampleFiles("example", "dist/example", packageName);
