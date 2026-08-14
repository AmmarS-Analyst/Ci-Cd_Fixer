const SYSTEM_PROMPT = `You are a CI/CD diagnostic agent. Given failed pipeline logs, respond ONLY with valid JSON, no other text:
{
  "root_cause": "short description of what actually broke",
  "confidence": <0-100 integer>,
  "proposed_fix": "concrete fix a human could apply",
  "action_type": "env_var|dependency|test|dockerfile|permissions|other"
}`;

async function diagnoseLogs(logText) {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      prompt: `${SYSTEM_PROMPT}\n\nLogs:\n${logText.slice(0, 8000)}`, // trim to keep it fast
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  try {
    return JSON.parse(data.response);
  } catch (e) {
    // Model didn't return clean JSON — log raw response so you can debug prompt quality
    console.warn("Failed to parse model response as JSON:", data.response);
    return {
      root_cause: "unparseable_model_response",
      confidence: 0,
      proposed_fix: null,
      action_type: "other",
    };
  }
}

module.exports = { diagnoseLogs };
