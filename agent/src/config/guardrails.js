// Phase 2 guardrail thresholds. All overridable via env so they can be
// tuned per-environment (and turned down hard in tests to prove they trip).
//
// Cost tracking: Ollama itself is free/local, so cost_usd is always $0 in
// practice today. We still compute it from token counts against a nominal
// paid-API rate (roughly GPT-4o-mini-class pricing) so the cost-ceiling
// guardrail is real and testable, and so the number has meaning the day this
// project swaps in a paid model for quality reasons — that swap is a
// documented tradeoff (see CLAUDE.md), not a silent behavior change.
const guardrails = {
  confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD || "70", 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || "2", 10),
  costCeilingUsd: parseFloat(process.env.COST_CEILING_USD || "0.05"),
  dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  costPer1kPromptTokensUsd: parseFloat(process.env.COST_PER_1K_PROMPT_TOKENS_USD || "0.00015"),
  costPer1kCompletionTokensUsd: parseFloat(
    process.env.COST_PER_1K_COMPLETION_TOKENS_USD || "0.0006"
  ),
};

function estimateCostUsd({ promptTokens, completionTokens }) {
  const promptCost = (promptTokens / 1000) * guardrails.costPer1kPromptTokensUsd;
  const completionCost = (completionTokens / 1000) * guardrails.costPer1kCompletionTokensUsd;
  return Number((promptCost + completionCost).toFixed(6));
}

module.exports = { guardrails, estimateCostUsd };
