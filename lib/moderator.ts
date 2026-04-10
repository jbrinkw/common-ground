"use server";

import Anthropic from "@anthropic-ai/sdk";
import type { ModeratorVerdict } from "./types";
import { DEFAULT_RUBRIC_SYSTEM_PROMPT } from "./rubrics/default_v1";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * Mock moderator for local dev when ANTHROPIC_API_KEY is not set.
 * Routes messages through both approve and revise paths based on content
 * so the full UI flow can be tested without real API keys.
 */
function mockModerate(draft: string): ModeratorVerdict {
  const lower = draft.toLowerCase();

  // Trigger rejection for testing
  if (lower.includes("reject") || lower.includes("bad")) {
    return {
      verdict: "revise",
      violated_rules: ["inflammatory_language"],
      explanation:
        "Your message contains language that could escalate the conversation. " +
        "Try rephrasing to focus on the substance of your point without charged words.",
      suggested_revision: draft.replace(/reject|bad/gi, "[constructive term]"),
      proposed_fact_updates: [],
    };
  }

  // Trigger rejection for long messages
  if (draft.length > 500) {
    return {
      verdict: "revise",
      violated_rules: ["message_length"],
      explanation:
        "Your message is quite long. Try to be more concise — shorter messages " +
        "tend to be more productive in a disagreement.",
      proposed_fact_updates: [],
    };
  }

  // Extract facts from "fact: ..." prefix
  const proposed_fact_updates: string[] = [];
  const factMatch = draft.match(/fact:\s*(.+)/i);
  if (factMatch) {
    proposed_fact_updates.push(factMatch[1].trim());
  }

  return {
    verdict: "approve",
    violated_rules: [],
    explanation: "Message approved.",
    proposed_fact_updates,
  };
}

export async function moderateMessage(args: {
  draft: string;
  recentMainMessages: Array<{ sender: string; content: string }>;
  establishedFacts: string[];
  sideChatHistory?: Array<{ role: "user" | "ai"; content: string }>;
  rubricId: string;
}): Promise<ModeratorVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Use mock moderator when no API key is configured (local dev)
  if (!apiKey) {
    return mockModerate(args.draft);
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

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: DEFAULT_RUBRIC_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    // Extract text content from the response
    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && "text" in textBlock ? textBlock.text : "";

    // Parse JSON from the response, handling markdown code fences
    const jsonStr = rawText.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as ModeratorVerdict;

    return {
      verdict: parsed.verdict,
      violated_rules: parsed.violated_rules ?? [],
      explanation: parsed.explanation ?? "",
      suggested_revision: parsed.suggested_revision,
      proposed_fact_updates: parsed.proposed_fact_updates ?? [],
    };
  } catch (error) {
    console.error("Moderator error:", error);
    // Fail-open: approve the message if the API call or parsing fails.
    // This prevents blocking conversation due to transient API issues.
    return {
      verdict: "approve",
      violated_rules: [],
      explanation: "Moderator unavailable — message auto-approved.",
      proposed_fact_updates: [],
    };
  }
}
