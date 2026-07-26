import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "hackwriter-package-smoke-"));
const installDirectory = join(temporaryDirectory, "install");
const cacheDirectory = join(temporaryDirectory, "npm-cache");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

try {
  const packed = JSON.parse(run("npm", [
    "pack",
    "--json",
    "--cache",
    cacheDirectory,
    "--pack-destination",
    temporaryDirectory,
  ]));
  const packageInfo = Array.isArray(packed)
    ? packed[0]
    : packed[packageJson.name] ?? Object.values(packed)[0];
  if (!packageInfo?.filename) {
    throw new Error("npm pack did not report a tarball filename");
  }
  const tarball = join(temporaryDirectory, packageInfo.filename);
  run("npm", [
    "install",
    "--prefix",
    installDirectory,
    "--cache",
    cacheDirectory,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);
  const cli = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "hackwriter.cmd" : "hackwriter",
  );
  const version = run(cli, ["--version"], { cwd: installDirectory });
  if (version !== packageJson.version) {
    throw new Error(`Packed CLI version ${version} does not match package.json ${packageJson.version}`);
  }
  console.log(`Packed install smoke passed for ${packageJson.name}@${version}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
