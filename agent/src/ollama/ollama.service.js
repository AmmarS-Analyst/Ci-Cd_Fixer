const SYSTEM_PROMPT = `You are a CI/CD diagnostic agent. Given failed pipeline logs, respond with ONLY this exact JSON object — no other text, no transcript, no step-by-step summary:
{
  "root_cause": "short description of what actually broke",
  "confidence": <0-100 integer>,
  "proposed_fix": "concrete fix a human could apply",
  "action_type": "env_var|dependency|test|dockerfile|permissions|other"
}
Do not summarize the log or narrate its steps. Find the actual error (look near the end of the log, after any "Error", "##[error]", "FAIL", or non-zero exit code) and diagnose only that.
"action_type" MUST be exactly one of those six values — never combine them.
If action_type is "dependency", "root_cause" MUST name the exact missing package in single quotes, e.g. root_cause: "Missing 'left-pad' dependency" — never a placeholder like <module_name>.`;

const VALID_ACTION_TYPES = ["env_var", "dependency", "test", "dockerfile", "permissions", "other"];

// This CPU-only 7B model was observed processing *prompt* tokens (not even
// generation) at ~7 tokens/sec under load. A max-size log slice at the old
// 8000-char (~2000-token) budget alone took 5+ minutes just to read before
// generating a single output token — independent of any client timeout.
// Capped lower here so prompt processing reliably finishes in ~1-2 minutes.
const MAX_LOG_CHARS = parseInt(process.env.OLLAMA_MAX_LOG_CHARS || "3000", 10);

// Real CI logs are mostly runner/setup boilerplate; the actual failure is
// almost always near the end. Strip low-signal noise (timestamps, ANSI
// color codes, GitHub's ##[group]/##[endgroup] folding markers) and keep the
// *tail* of the log rather than the head, so the token budget is spent on
// the failure itself instead of "Acquiring node 20.20.2 from...".
function cleanLogText(logText, maxChars) {
  const cleaned = logText
    .replace(/\[[0-9;]*m/g, "")
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/gm, "")
    .replace(/^##\[(group|endgroup)\].*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.length > maxChars ? cleaned.slice(-maxChars) : cleaned;
}

function normalizeDiagnosis(raw) {
  const confidence = Number.isInteger(raw.confidence)
    ? Math.max(0, Math.min(100, raw.confidence))
    : 0;

  const actionType = VALID_ACTION_TYPES.includes(raw.action_type) ? raw.action_type : "other";

  return {
    root_cause: raw.root_cause || "unknown",
    confidence,
    proposed_fix: raw.proposed_fix || null,
    action_type: actionType,
  };
}

// With stream:false, Ollama sends nothing at all — not even response headers
// — until generation is fully done, and even with stream:true, Ollama sends
// no bytes until *prompt processing* (reading the input) finishes. Undici's
// default 5-minute headersTimeout applies regardless of any AbortSignal —
// it's a socket-level setting on the connection, not on the fetch call — so
// slow prompt processing alone can trip it even when the server is fine.
// A custom Agent with both timeouts raised is required to actually override it.
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || "600000", 10);
const { Agent } = require("undici");
const ollamaDispatcher = new Agent({
  headersTimeout: OLLAMA_TIMEOUT_MS,
  bodyTimeout: OLLAMA_TIMEOUT_MS,
});

async function diagnoseLogs(logText) {
  const res = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      prompt: `${SYSTEM_PROMPT}\n\nLogs:\n${cleanLogText(logText, MAX_LOG_CHARS)}`,
      stream: true,
      format: "json",
      // Observed the model ramble past 2,600 tokens on some real-world logs
      // instead of stopping at the ~100-token JSON schema — at CPU inference
      // speed that alone can exceed any reasonable timeout. The response
      // schema never needs more than a couple hundred tokens, so cap it hard.
      options: { num_predict: 300 },
    }),
    dispatcher: ollamaDispatcher,
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  // Ollama streams newline-delimited JSON objects, each with a "response"
  // fragment; the final one (done: true) carries the token-count totals.
  // Network chunks don't align with NDJSON line boundaries, so a line can
  // arrive split across two chunks — buffer any trailing partial line and
  // prepend it to the next chunk instead of parsing chunks independently.
  let responseText = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop(); // last segment may be incomplete — keep for next chunk

    for (const line of lines.filter(Boolean)) {
      const parsed = JSON.parse(line);
      responseText += parsed.response || "";
      if (parsed.done) {
        promptTokens = parsed.prompt_eval_count || 0;
        completionTokens = parsed.eval_count || 0;
      }
    }
  }

  if (buffer.trim()) {
    const parsed = JSON.parse(buffer);
    responseText += parsed.response || "";
    if (parsed.done) {
      promptTokens = parsed.prompt_eval_count || 0;
      completionTokens = parsed.eval_count || 0;
    }
  }

  try {
    const diagnosis = normalizeDiagnosis(JSON.parse(responseText));
    return { diagnosis, promptTokens, completionTokens };
  } catch (e) {
    // Model didn't return clean JSON — log raw response so you can debug prompt quality
    console.warn("Failed to parse model response as JSON:", responseText);
    return {
      diagnosis: {
        root_cause: "unparseable_model_response",
        confidence: 0,
        proposed_fix: null,
        action_type: "other",
      },
      promptTokens,
      completionTokens,
    };
  }
}

module.exports = { diagnoseLogs };
