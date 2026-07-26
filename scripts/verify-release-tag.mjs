import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const actualTag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${packageJson.version}`;

if (actualTag !== expectedTag) {
  console.error(`Release tag ${actualTag ?? "<missing>"} does not match ${expectedTag}`);
  process.exitCode = 1;
} else {
  console.log(`Release tag matches package version: ${expectedTag}`);
}
