import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";

import type { Configuration } from "../../src/config/Configuration.ts";
import { ModelService } from "../../src/config/ModelService.ts";

const EXPECTED_PROVIDERS = [
  "amazon-bedrock", "ant-ling", "anthropic", "azure-openai-responses",
  "cerebras", "cloudflare-ai-gateway", "cloudflare-workers-ai", "deepseek",
  "fireworks", "github-copilot", "google", "google-vertex", "groq",
  "huggingface", "kimi-coding", "minimax", "minimax-cn", "mistral",
  "moonshotai", "moonshotai-cn", "nvidia", "openai", "openai-codex",
  "opencode", "opencode-go", "openrouter", "together", "vercel-ai-gateway",
  "xai", "xiaomi", "xiaomi-token-plan-ams", "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp", "zai", "zai-coding-cn",
].sort();

function config(): Configuration {
  return {
    version: 2,
    defaultModel: "",
    models: {},
    providers: {},
    services: {},
    loopControl: { maxStepsPerRun: 100, maxRetriesPerStep: 3 },
  };
}

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("ModelService", () => {
  it("registers every built-in text provider plus Ollama", () => {
    expect(ModelService.builtinProviderIds().sort()).toEqual(EXPECTED_PROVIDERS);
    const service = new ModelService(config(), new InMemoryCredentialStore());
    expect(service.models.getProvider("ollama")).toBeDefined();
    expect(service.models.getProviders()).toHaveLength(36);
  });

  it("uses provider-owned stored API-key auth", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("anthropic", async () => ({
      type: "api_key",
      key: "test-anthropic-key",
    }));
    const service = new ModelService(config(), credentials);
    const model = service.models.getModels("anthropic")[0];
    await expect(service.models.getAuth(model)).resolves.toMatchObject({
      source: "stored credential",
      auth: { apiKey: "test-anthropic-key" },
    });
  });

  it("refreshes Ollama models from its dynamic /api/tags catalog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      models: [{
        name: "llama3.2:latest",
        modified_at: "2026-01-01T00:00:00Z",
        size: 1,
        digest: "digest",
        details: {
          format: "gguf",
          family: "llama",
          families: ["llama"],
          parameter_size: "3B",
          quantization_level: "Q4",
        },
      }],
    }), { status: 200 }));
    const service = new ModelService(config(), new InMemoryCredentialStore());
    await service.initialize();
    expect(service.resolve("ollama/llama3.2:latest")?.model.baseUrl).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("streams to Ollama without requiring or sending an API key", async () => {
    let requestHeaders: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      requestHeaders = request instanceof Request
        ? request.headers
        : new Headers(init?.headers);
      return new Response(JSON.stringify({ error: { message: "offline test" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    });
    const value = config();
    value.providers.ollama = {
      type: "ollama",
      baseUrl: "http://localhost:11434",
    };
    value.models.local = {
      provider: "ollama",
      model: "gemma4:31b-cloud",
      maxContextSize: 128_000,
    };
    const service = new ModelService(value, new InMemoryCredentialStore());
    const model = service.resolve("local")!.model;

    const result = await service.models.completeSimple(model, { messages: [] });

    expect(result.errorMessage).not.toContain("No API key");
    expect(requestHeaders?.has("authorization")).toBe(false);
  });

  it("detects environment and ambient AWS credentials", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.AWS_ACCESS_KEY_ID = "test-access";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
    const service = new ModelService(config(), new InMemoryCredentialStore());
    await expect(
      service.models.getAuth(service.models.getModels("openai")[0]),
    ).resolves.toMatchObject({ source: "OPENAI_API_KEY" });
    await expect(
      service.models.getAuth(service.models.getModels("amazon-bedrock")[0]),
    ).resolves.toMatchObject({ source: "AWS access keys" });
  });

  it("uses a stored OAuth credential through provider-owned auth", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai-codex", () => Promise.resolve({
      type: "oauth",
      access: "oauth-access-token",
      refresh: "oauth-refresh-token",
      expires: Date.now() + 60_000,
    }));
    const service = new ModelService(config(), credentials);
    const auth = await service.models.getAuth(
      service.models.getModels("openai-codex")[0],
    );
    expect(auth?.source).toBe("OAuth");
    expect(auth?.auth.apiKey).toBe("oauth-access-token");
  });

  it("resolves canonical IDs, legacy IDs and configured aliases", () => {
    const value = config();
    value.models.fast = {
      provider: "openai",
      model: "gpt-5",
      maxContextSize: 200_000,
    };
    const service = new ModelService(value, new InMemoryCredentialStore());
    expect(service.resolve("openai/gpt-5")?.canonicalId).toBe("openai/gpt-5");
    expect(service.resolve("openai-gpt-5")?.canonicalId).toBe("openai/gpt-5");
    expect(service.resolve("fast")?.canonicalId).toBe("openai/gpt-5");
  });

  it("limits model search output while reporting the total", () => {
    const service = new ModelService(config(), new InMemoryCredentialStore());
    const result = service.search("a", 20);
    expect(result.total).toBeGreaterThan(20);
    expect(result.matches).toHaveLength(20);
  });
});
