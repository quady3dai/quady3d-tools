import { build } from "esbuild";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const output = fileURLToPath(new URL("dist/", import.meta.url));
await mkdir(output, { recursive: true });
const inputs = new Set();
for (const name of ["index", "cli"]) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`src/${name}.ts`, import.meta.url))],
    outfile: fileURLToPath(new URL(`dist/${name}.mjs`, import.meta.url)),
    bundle: true, platform: "node", target: "node22", format: "esm",
    legalComments: "external", sourcemap: false, metafile: true,
    banner: { js: `${name === "cli" ? "#!/usr/bin/env node\n" : ""}import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);` },
  });
  for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
}
await chmod(new URL("dist/cli.mjs", import.meta.url), 0o755);

const packages = new Map();
const resolvedDirectories = new Map();
for (const input of inputs) {
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory)) {
    if (resolvedDirectories.has(directory)) break;
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name && pkg.version) {
        resolvedDirectories.set(directory, true);
        if (!pkg.name.startsWith("@quady3d/")) packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
        break;
      }
    } catch { /* An input may be nested below the package manifest. */ }
    directory = dirname(directory);
  }
}
const notices = ["# Third-party dependencies bundled in Quady3D MCP\n"];
for (const [identity, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  notices.push(`\n## ${identity}\n\nLicense: ${pkg.license ?? "See package license"}\n`);
  const licenses = (await readdir(directory)).filter(name => /^(license|copying|notice)(\.|$)/i.test(name));
  if (!licenses.length) throw new Error(`Missing bundled dependency license: ${identity}`);
  for (const name of licenses) {
    const file = join(directory, name); const info = await stat(file);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error(`Inspect dependency license before packaging: ${identity}`);
    notices.push(`\n${await readFile(file, "utf8")}\n`);
  }
}
await writeFile(join(output, "THIRD_PARTY_NOTICES.txt"), notices.join(""));
