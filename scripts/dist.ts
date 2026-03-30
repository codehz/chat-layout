import { $ } from "bun";
import { createBundle } from "dts-buddy";
import { cp, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await rm(".types", { recursive: true, force: true });

const { success, logs } = await Bun.build({
  entrypoints: ["src/index.ts"],
  target: "bun",
  outdir: "dist",
  sourcemap: "linked",
});

for (const log of logs) {
  console.log(log);
}

if (!success) {
  process.exit(1);
}

await $`bunx tsc -p tsconfig.build.json`;

createBundle({
  project: "tsconfig.build.json",
  output: "dist/index.d.ts",
  modules: {
    ".": ".types/src/index.d.ts",
  },
});

const dtsContent = await readFile("dist/index.d.ts", "utf-8");
const dtsLines = dtsContent.split("\n");
if (/^declare module ['"]\.[/'"]?['"] \{$/.test(dtsLines[0] ?? "")) {
  let end = dtsLines.length;
  while (
    end > 0 &&
    (dtsLines[end - 1].trim() === "" || dtsLines[end - 1].startsWith("//# sourceMappingURL="))
  ) {
    end -= 1;
  }
  if (dtsLines[end - 1]?.trim() === "export {};") {
    end -= 1;
  }
  if (dtsLines[end - 1]?.trim() === "}") {
    end -= 1;
  }

  const normalized = dtsLines
    .slice(1, end)
    .map((line) => (line.startsWith("\t") ? line.slice(1) : line))
    .join("\n");
  await writeFile("dist/index.d.ts", `${normalized}\n`);
}

const flattenedDts = await readFile("dist/index.d.ts", "utf-8");
const cleanedDts = flattenedDts.replace(/\nexport \{\};\s*$/, "\n");
if (cleanedDts !== flattenedDts) {
  await writeFile("dist/index.d.ts", cleanedDts);
}

await rm(".types", { recursive: true, force: true });

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
packageJson.main = "./index.js";
packageJson.module = "./index.js";
packageJson.types = "./index.d.ts";
packageJson.exports = {
  ".": {
    import: "./index.js",
    types: "./index.d.ts",
  },
};

await Bun.write("dist/package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
