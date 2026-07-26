import { basename } from "node:path";

const PRIVATE_KEY_NAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

const CREDENTIAL_FILE_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials",
  "credentials.json",
]);

export function isSensitiveFilePath(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();
  if (name === ".env.example") return false;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.endsWith(".pem") || name.endsWith(".key") || name.endsWith(".p12")) {
    return true;
  }
  return PRIVATE_KEY_NAMES.has(name) || CREDENTIAL_FILE_NAMES.has(name);
}
