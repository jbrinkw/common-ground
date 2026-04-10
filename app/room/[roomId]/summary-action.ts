"use server";

import Anthropic from "@anthropic-ai/sdk";

export async function generateSummary(roomId: string): Promise<{ summary: string } | { error: string }> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Fetch room with profiles
    const { data: room } = await supabase
      .from("rooms")
      .select(`
        topic,
        user_a_id,
        user_a_profile:profiles!rooms_user_a_id_fkey(display_name),
        user_b_profile:profiles!rooms_user_b_id_fkey(display_name)
      `)
      .eq("id", roomId)
      .single();

    // Fetch all messages
    const { data: messages } = await supabase
      .from("main_messages")
      .select("sender_id, content, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    // Fetch established facts
    const { data: facts } = await supabase
      .from("established_facts")
      .select("content")
      .eq("room_id", roomId);

    if (!messages || messages.length === 0) {
      return { error: "No messages to summarize" };
    }

    const userAName = (room?.user_a_profile as { display_name?: string } | null)?.display_name ?? "User A";
    const userBName = (room?.user_b_profile as { display_name?: string } | null)?.display_name ?? "User B";

    const transcript = messages.map((m) => {
      const name = m.sender_id === room?.user_a_id ? userAName : userBName;
      return `${name}: ${m.content}`;
    }).join("\n");

    const factsText = (facts ?? []).map((f) => f.content).join("\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { error: "API key not configured" };

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Summarize this conversation between ${userAName} and ${userBName}${room?.topic ? ` about "${room.topic}"` : ""}.

## Conversation
${transcript}

${factsText ? `## Established Facts\n${factsText}` : ""}

Write a concise summary covering:
1. What was discussed
2. Key points each person made
3. What they agreed on (if anything)
4. What remains unresolved

Keep it to 3-5 short paragraphs. Be neutral — don't take sides.`,
      }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const summary = textBlock && "text" in textBlock ? textBlock.text : "Could not generate summary";

    return { summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate summary";
    return { error: message };
  }
}
