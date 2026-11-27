import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { ADMIN_OID, USER_OID, buildApp, makeConfig, signedInAgent } from "./helpers.js";
import { MemoryToolRepository } from "../src/catalog/tool-repository.js";
import { seedTools } from "../src/catalog/seed.js";
import { silentLogger } from "../src/logger.js";
import {
  AnthropicChatProvider,
  COMING_SOON_REPLY,
  ChatUnavailableError,
  type AnthropicLike,
  type ChatProvider,
  type ChatRequest,
} from "../src/chat/provider.js";

function recordingProvider(reply = "Try Microsoft 365.") {
  const calls: ChatRequest[] = [];
  const provider: ChatProvider = {
    name: "test",
    async reply(r) {
      calls.push(r);
      return reply;
    },
  };
  return { provider, calls };
}

describe("POST /api/chat", () => {
  it("answers 'coming soon' when no ANTHROPIC_API_KEY is set", async () => {
    const agent = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID })));
    const res = await agent.post("/api/chat").send({ message: "I need to file expenses" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: COMING_SOON_REPLY });
  });

  it("passes the message and only the live, enabled catalog to the provider", async () => {
    const tools = new MemoryToolRepository();
    await tools.seedIfEmpty(seedTools());
    const { provider, calls } = recordingProvider();
    // Even for an admin, the Power BI draft is never suggested.
    const agent = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: ADMIN_OID }), { tools, chatProvider: provider }));
    const res = await agent.post("/api/chat").send({ message: "  where is my email?  " });
    expect(res.body).toEqual({ reply: "Try Microsoft 365." });
    expect(calls[0]!.message).toBe("where is my email?");
    expect(calls[0]!.catalog).toHaveLength(3);
    expect(calls[0]!.catalog.join("\n")).toContain("Outlook on the web (Microsoft Hub)");
    expect(calls[0]!.catalog.join("\n")).not.toContain("Example Power BI report");
  });

  it("validates the message and rate-limits per user", async () => {
    const { provider } = recordingProvider();
    const agent = await signedInAgent(
      buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID, CHAT_RATE_PER_MINUTE: "2" }), { chatProvider: provider }),
    );
    expect((await agent.post("/api/chat").send({})).status).toBe(400);
    expect((await agent.post("/api/chat").send({ message: "x".repeat(2001) })).status).toBe(400);
    expect((await agent.post("/api/chat").send({ message: "one" })).status).toBe(200);
    expect((await agent.post("/api/chat").send({ message: "two" })).status).toBe(200);
    const third = await agent.post("/api/chat").send({ message: "three" });
    expect(third.status).toBe(429);
    expect(third.body.success).toBe(false);
  });

  it("maps provider failures to JSON 502/503", async () => {
    const provider: ChatProvider = {
      name: "down",
      async reply() {
        throw new ChatUnavailableError("The assistant is busy right now. Try again in a minute.", 503);
      },
    };
    const agent = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }), { chatProvider: provider }));
    const res = await agent.post("/api/chat").send({ message: "hi" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: "The assistant is busy right now. Try again in a minute." });
  });
});

describe("AnthropicChatProvider", () => {
  function fakeClient(answer: Partial<Anthropic.Beta.BetaMessage> | Error) {
    const requests: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          create: async (body: Record<string, unknown>) => {
            requests.push(body);
            if (answer instanceof Error) throw answer;
            return { stop_reason: "end_turn", content: [], ...answer };
          },
        },
      },
    } as unknown as AnthropicLike;
    return { client, requests };
  }

  it("sends the model, low effort, the default refusal fallback and the catalog", async () => {
    const { client, requests } = fakeClient({ content: [{ type: "text", text: "Use Outlook on the web." } as Anthropic.Beta.BetaTextBlock] });
    const p = new AnthropicChatProvider({ apiKey: "k", model: "claude-opus-5-5", logger: silentLogger, client });
    const reply = await p.reply({ message: "email", catalog: ["- Outlook on the web (Microsoft Hub)"] });
    expect(reply).toBe("Use Outlook on the web.");
    const body = requests[0]!;
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: "email" }],
    });
    expect(JSON.stringify(body.system)).toContain("Outlook on the web (Microsoft Hub)");
    expect(body).not.toHaveProperty("thinking");
  });

  it("omits fallbacks for models without server-side fallback", async () => {
    const { client, requests } = fakeClient({ content: [{ type: "text", text: "ok" } as Anthropic.Beta.BetaTextBlock] });
    await new AnthropicChatProvider({ apiKey: "k", model: "claude-haiku-5-5", logger: silentLogger, client }).reply({ message: "m", catalog: [] });
    expect(requests[0]).not.toHaveProperty("fallbacks");
    expect(requests[0]).not.toHaveProperty("betas");
  });

  it("turns a refusal into a polite reply and an API error into ChatUnavailableError", async () => {
    const refused = fakeClient({ stop_reason: "refusal", content: [] });
    const p1 = new AnthropicChatProvider({ apiKey: "k", model: "claude-opus-5-5", logger: silentLogger, client: refused.client });
    expect(await p1.reply({ message: "m", catalog: [] })).toMatch(/can't help/);

    const failing = fakeClient(new Error("boom"));
    const p2 = new AnthropicChatProvider({ apiKey: "k", model: "claude-opus-5-5", logger: silentLogger, client: failing.client });
    await expect(p2.reply({ message: "m", catalog: [] })).rejects.toMatchObject({ name: "ChatUnavailableError", status: 502 });
  });
});
