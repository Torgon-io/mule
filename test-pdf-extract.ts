// Quick test to see what the AI SDK does with systemPrompt and file messages
import { createOpenRouter } from "npm:@openrouter/ai-sdk-provider";
import { generateText } from "npm:ai@^5.0.93";

const openrouter = createOpenRouter({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
});

const result = await generateText({
  model: openrouter("google/gemini-2.5-flash"),
  messages: [
    {
      role: "user",
      content: "Extract this: Hello World Test Document"
    }
  ],
  systemPrompt: "You must extract ALL text without summarization.",
  temperature: 0,
});

console.log("Result:", result.text);
console.log("\n=== Full response object ===");
console.log(JSON.stringify(result, null, 2));
