import { buildPrompt } from "./prompt.mjs";
import { runProvider } from "./provider.mjs";
import { loadAgentConfig } from "../config/agent.mjs";
import { readStdin } from "../shared/stdin.mjs";

export async function runFeishuAgent(config = loadAgentConfig()) {
  const input = await readStdin();
  const envelope = JSON.parse(input);
  const prompt = await buildPrompt(envelope, config);
  const reply = await runProvider(prompt, envelope, config);
  process.stdout.write(`${reply.trim()}\n`);
}

