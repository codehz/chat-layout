const { success, logs } = await Bun.build({
  entrypoints: ["chat.ts"],
  outdir: "build",
});

for (const log of logs) {
  console.log(log);
}

if (!success) {
  process.exit(1);
}
