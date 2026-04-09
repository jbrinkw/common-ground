"use server";

import Anthropic from "@anthropic-ai/sdk";
import type { ModeratorVerdict } from "./types";
import { DEFAULT_RUBRIC_SYSTEM_PROMPT } from "./rubrics/default_v1";

const MODEL = "claude-sonnet-4-6-20250514";

export async function moderateMessage(args: {
  draft: string;
  recentMainMessages: Array<{ sender: string; content: string }>;
  establishedFacts: string[];
  sideChatHistory?: Array<{ role: "user" | "ai"; content: string }>;
  rubricId: string;
}): Promise<ModeratorVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // If no API key is configured, approve everything (local dev mode)
  if (!apiKey) {
    return {
      verdict: "approve",
      violated_rules: [],
      explanation: "Auto-approved (no ANTHROPIC_API_KEY configured)",
      proposed_fact_updates: [],
    };
  }

  const client = new Anthropic({ apiKey });

  // Build the user message with all context
  const contextParts: string[] = [];

  if (args.recentMainMessages.length > 0) {
    contextParts.push(
      "## Recent conversation\n" +
        args.recentMainMessages
          .map((m) => `${m.sender}: ${m.content}`)
          .join("\n")
    );
  }

  if (args.establishedFacts.length > 0) {
    contextParts.push(
      "## Established facts\n" +
        args.establishedFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    );
  }

  if (args.sideChatHistory && args.sideChatHistory.length > 0) {
    contextParts.push(
      "## Prior revision discussion\n" +
        args.sideChatHistory
          .map((m) => `${m.role === "ai" ? "Moderator" : "Sender"}: ${m.content}`)
          .join("\n")
    );
  }

  contextParts.push(`## Draft message to evaluate\n${args.draft}`);

  const userContent = contextParts.join("\n\n");

  const startTime = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: DEFAULT_RUBRIC_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const latencyMs = Date.now() - startTime;

  // Extract text content from the response
  const textBlock = response.content.find((block) => block.type === "text");
  const rawText = textBlock && "text" in textBlock ? textBlock.text : "";

  try {
    // Try to parse JSON from the response, handling markdown code fences
    const jsonStr = rawText.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as ModeratorVerdict;

    return {
      verdict: parsed.verdict,
      violated_rules: parsed.violated_rules ?? [],
      explanation: parsed.explanation ?? "",
      suggested_revision: parsed.suggested_revision,
      proposed_fact_updates: parsed.proposed_fact_updates ?? [],
      _latencyMs: latencyMs,
    } as ModeratorVerdict & { _latencyMs: number };
  } catch {
    // If we can't parse the response, approve with a warning
    return {
      verdict: "approve",
      violated_rules: [],
      explanation: "Moderator response could not be parsed — auto-approved.",
      proposed_fact_updates: [],
    };
  }
}
