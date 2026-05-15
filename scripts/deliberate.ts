#!/usr/bin/env bun
/**
 * Deliberate — Multi-Model Deliberation Orchestrator for PAI
 *
 * Unlike Council (simulated perspectives from one model), Deliberate runs
 * actual multi-model debate: Claude, Gemini, Grok, and GPT each bring their
 * own reasoning biases, training data, and blind spots.
 *
 * Architecture:
 *   Round 1: Each model answers independently (parallel)
 *   Round 2+: Each model sees all prior responses, revises position (parallel per round)
 *   Final: Synthesis with convergence analysis, confidence, dissenting views
 *
 * Claude calls use PAI Inference (subscription auth, no API key needed).
 * External models use direct API calls (keys from env vars).
 *
 * Usage:
 *   bun deliberate.ts "Should we use WebSockets or SSE for real-time updates?"
 *   bun deliberate.ts --rounds 3 --models claude,gemini,grok "Question here"
 *   bun deliberate.ts --rounds 2 --output report.md "Question here"
 *   bun deliberate.ts --config custom-panel.json "Question here"
 *   bun deliberate.ts --mode research "What are the latest Claude Code hook capabilities?"
 *   bun deliberate.ts --mode research --models gemini,grok "Current state of WebLLM?"
 *
 * Environment variables for external models:
 *   GEMINI_API_KEY    — Google Gemini
 *   GROK_API_KEY      — xAI Grok
 *   OPENAI_API_KEY    — OpenAI GPT
 */

import { parseArgs } from "util";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { inference, type InferenceLevel } from "../PAI/Tools/Inference.ts";

// --- Types ---

type ExecutionMode = "debate" | "research";

interface ModelConfig {
  id: string;
  name: string;
  provider: "claude" | "gemini" | "openai-compatible";
  model: string;
  persona: string;
  systemPrompt: string;
  envKey?: string; // env var for API key (not needed for Claude)
  baseUrl?: string; // base URL for OpenAI-compatible providers
  supportsGrounding?: boolean; // whether this model can do web search in research mode
}

interface RoundResponse {
  modelId: string;
  modelName: string;
  provider: string;
  content: string;
  latencyMs: number;
  error?: string;
}

interface DeliberationRound {
  round: number;
  responses: RoundResponse[];
  timestamp: string;
}

interface DeliberationResult {
  question: string;
  rounds: DeliberationRound[];
  synthesis: string;
  models: string[];
  totalDurationMs: number;
  timestamp: string;
}

interface PanelConfig {
  models: ModelConfig[];
}

// --- Default Model Panel ---

const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "claude",
    name: "Claude (Opus)",
    provider: "claude",
    model: "opus",
    persona: "Architect",
    systemPrompt: `You are a deliberation panelist. Your perspective emphasizes systems thinking, long-term architecture, and structural clarity. You are direct, precise, and focused on trade-offs. When you disagree with another panelist, say so clearly and explain why. When you agree, build on their point rather than restating it.`,
  },
  {
    id: "gemini",
    name: "Gemini (Flash)",
    provider: "gemini",
    model: "gemini-2.5-flash",
    persona: "Researcher",
    systemPrompt: `You are a deliberation panelist. Your perspective emphasizes evidence, data, real-world precedent, and empirical analysis. You cite specific examples and counter-examples. When you disagree with another panelist, ground your objection in evidence. When you agree, add supporting data they missed.`,
    envKey: "GEMINI_API_KEY",
    supportsGrounding: true,
  },
  {
    id: "grok",
    name: "Grok",
    provider: "openai-compatible",
    model: "grok-3",
    persona: "Contrarian",
    systemPrompt: `You are a deliberation panelist. Your perspective is contrarian and unfiltered. You challenge assumptions, point out what others are avoiding, and stress-test popular positions. You value truth over consensus. When you disagree, be blunt. When you agree, explain what surprised you about agreeing.`,
    envKey: "GROK_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    supportsGrounding: true,
  },
  {
    id: "gpt",
    name: "GPT-4o",
    provider: "openai-compatible",
    model: "gpt-4o",
    persona: "Pragmatist",
    systemPrompt: `You are a deliberation panelist. Your perspective emphasizes practical implementation, user impact, and shipping. You focus on what actually works in production. When you disagree, explain the real-world cost. When you agree, propose concrete next steps.`,
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "deepseek",
    name: "DeepSeek (Reasoner)",
    provider: "openai-compatible",
    model: "deepseek-reasoner",
    persona: "Reasoner",
    systemPrompt: `You are a deliberation panelist. Your perspective emphasizes rigorous step-by-step reasoning and exposing your chain of thought. You break complex questions into sub-problems, examine each systematically, and show your work. When you disagree, walk through the logical flaw. When you agree, extend the reasoning chain further.`,
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
  },
  {
    id: "mistral",
    name: "Mistral Large",
    provider: "openai-compatible",
    model: "mistral-large-latest",
    persona: "Strategist",
    systemPrompt: `You are a deliberation panelist. Your perspective emphasizes strategic analysis, nuanced trade-offs, and multi-dimensional evaluation. You consider cultural, technical, and business dimensions that others may overlook. When you disagree, reframe the problem to show what's being missed. When you agree, add the dimension no one mentioned.`,
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
  },
];

// --- Model Invocation ---

async function invokeClaudeModel(
  config: ModelConfig,
  userPrompt: string,
): Promise<{ content: string; latencyMs: number; error?: string }> {
  const level: InferenceLevel =
    config.model === "haiku" ? "fast" : config.model === "sonnet" ? "standard" : "smart";

  const result = await inference({
    systemPrompt: config.systemPrompt,
    userPrompt,
    level,
    timeout: 120_000,
  });

  if (!result.success) {
    return { content: "", latencyMs: result.latencyMs, error: result.error };
  }
  return { content: result.output, latencyMs: result.latencyMs };
}

async function invokeGemini(
  config: ModelConfig,
  userPrompt: string,
  options?: { grounding?: boolean },
): Promise<{ content: string; latencyMs: number; error?: string; citations?: string[] }> {
  const apiKey = process.env[config.envKey!];
  if (!apiKey) {
    return { content: "", latencyMs: 0, error: `Missing ${config.envKey} env var` };
  }

  const start = Date.now();
  try {
    const requestBody: any = {
      system_instruction: { parts: [{ text: config.systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    };

    if (options?.grounding) {
      requestBody.tools = [{ google_search: {} }];
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { content: "", latencyMs: Date.now() - start, error: `Gemini ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as any;
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Extract citations from grounding metadata
    const citations: string[] = [];
    const groundingMeta = data.candidates?.[0]?.groundingMetadata;
    if (groundingMeta?.groundingChunks) {
      for (const chunk of groundingMeta.groundingChunks) {
        if (chunk.web?.uri) citations.push(chunk.web.uri);
      }
    }

    return { content, latencyMs: Date.now() - start, citations: citations.length > 0 ? citations : undefined };
  } catch (e: any) {
    return { content: "", latencyMs: Date.now() - start, error: e.message };
  }
}

async function invokeOpenAICompatible(
  config: ModelConfig,
  userPrompt: string,
  options?: { grounding?: boolean },
): Promise<{ content: string; latencyMs: number; error?: string; citations?: string[] }> {
  const apiKey = process.env[config.envKey!];
  if (!apiKey) {
    return { content: "", latencyMs: 0, error: `Missing ${config.envKey} env var` };
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const start = Date.now();
  try {
    const requestBody: any = {
      model: config.model,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    };

    // Grok web search: top-level search_parameters field
    if (options?.grounding && config.id === "grok") {
      requestBody.search_parameters = { mode: "auto" };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { content: "", latencyMs: Date.now() - start, error: `${config.name} ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content ?? "";

    // Extract citations from Grok search results (if present)
    const citations: string[] = [];
    if (data.citations) {
      for (const cite of data.citations) {
        if (typeof cite === 'string') citations.push(cite);
        else if (cite?.url) citations.push(cite.url);
      }
    }

    return { content, latencyMs: Date.now() - start, citations: citations.length > 0 ? citations : undefined };
  } catch (e: any) {
    return { content: "", latencyMs: Date.now() - start, error: e.message };
  }
}

async function invokeModel(
  config: ModelConfig,
  userPrompt: string,
  options?: { grounding?: boolean },
): Promise<{ content: string; latencyMs: number; error?: string; citations?: string[] }> {
  const useGrounding = options?.grounding && config.supportsGrounding;
  switch (config.provider) {
    case "claude":
      return invokeClaudeModel(config, userPrompt);
    case "gemini":
      return invokeGemini(config, userPrompt, { grounding: useGrounding });
    case "openai-compatible":
      return invokeOpenAICompatible(config, userPrompt, { grounding: useGrounding });
    default:
      return { content: "", latencyMs: 0, error: `Unknown provider: ${config.provider}` };
  }
}

// --- Prompt Builders ---

function buildRound1Prompt(question: string): string {
  return `DELIBERATION — Round 1 (Initial Position)

QUESTION:
${question}

Give your position in 150-300 words. Be specific and direct. State your recommendation clearly, then explain your reasoning. Include trade-offs you see.`;
}

function buildRound2Prompt(
  question: string,
  round: number,
  totalRounds: number,
  previousRounds: DeliberationRound[],
): string {
  const transcript = previousRounds
    .map((r) => {
      const roundResponses = r.responses
        .filter((resp) => !resp.error)
        .map((resp) => `**${resp.modelName} (${resp.provider}):**\n${resp.content}`)
        .join("\n\n");
      return `### Round ${r.round}\n\n${roundResponses}`;
    })
    .join("\n\n---\n\n");

  return `DELIBERATION — Round ${round}/${totalRounds} (Response & Revision)

QUESTION:
${question}

TRANSCRIPT SO FAR:
${transcript}

---

Review the other panelists' positions above. In 150-300 words:
1. Directly address points you disagree with (name the panelist)
2. Acknowledge points that changed or refined your thinking
3. State your updated position (it's OK to shift or hold firm)
4. Identify the key unresolved tension in this debate`;
}

function buildSynthesisPrompt(question: string, rounds: DeliberationRound[]): string {
  const transcript = rounds
    .map((r) => {
      const roundResponses = r.responses
        .filter((resp) => !resp.error)
        .map((resp) => `**${resp.modelName}:**\n${resp.content}`)
        .join("\n\n");
      return `### Round ${r.round}\n\n${roundResponses}`;
    })
    .join("\n\n---\n\n");

  return `DELIBERATION SYNTHESIS

QUESTION:
${question}

FULL TRANSCRIPT:
${transcript}

---

Synthesize this multi-model deliberation into a final report. Include:

1. **Recommendation** — The strongest path forward, with confidence level (high/medium/low)
2. **Convergence** — Points where multiple models agreed (name them)
3. **Key Tensions** — Unresolved disagreements and why they matter
4. **Dissenting Views** — Positions that went against consensus but had merit
5. **Blind Spots** — What the panel may have missed or underweighted
6. **Next Steps** — Concrete actions if moving forward

Be direct. 200-400 words.`;
}

// --- Formatting ---

function formatReport(result: DeliberationResult): string {
  const lines: string[] = [];
  lines.push(`# Deliberation: ${result.question}`);
  lines.push("");
  lines.push(`**Date:** ${result.timestamp}`);
  lines.push(`**Models:** ${result.models.join(", ")}`);
  lines.push(`**Rounds:** ${result.rounds.length}`);
  lines.push(`**Duration:** ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push("");

  for (const round of result.rounds) {
    lines.push(`## Round ${round.round}`);
    lines.push("");
    for (const resp of round.responses) {
      if (resp.error) {
        lines.push(`### ${resp.modelName} — ERROR`);
        lines.push(`> ${resp.error}`);
      } else {
        lines.push(`### ${resp.modelName} (${(resp.latencyMs / 1000).toFixed(1)}s)`);
        lines.push(resp.content);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push("## Synthesis");
  lines.push("");
  lines.push(result.synthesis);
  lines.push("");

  return lines.join("\n");
}

// --- Main Loop ---

async function deliberate(
  question: string,
  models: ModelConfig[],
  numRounds: number,
  verbose: boolean,
): Promise<DeliberationResult> {
  const startTime = Date.now();
  const rounds: DeliberationRound[] = [];

  // Filter to models with available credentials
  const availableModels = models.filter((m) => {
    if (m.provider === "claude") return true;
    const key = m.envKey ? process.env[m.envKey] : null;
    if (!key) {
      if (verbose) console.error(`  Skipping ${m.name}: missing ${m.envKey}`);
      return false;
    }
    return true;
  });

  if (availableModels.length === 0) {
    throw new Error("No models available. Set at least one API key or ensure Claude CLI is available.");
  }

  console.log(`\n=== Deliberation ===`);
  console.log(`Question: ${question.slice(0, 100)}${question.length > 100 ? "..." : ""}`);
  console.log(`Models: ${availableModels.map((m) => m.name).join(", ")}`);
  console.log(`Rounds: ${numRounds}`);
  console.log("");

  for (let round = 1; round <= numRounds; round++) {
    const roundStart = Date.now();

    const prompt =
      round === 1
        ? buildRound1Prompt(question)
        : buildRound2Prompt(question, round, numRounds, rounds);

    console.log(`[Round ${round}/${numRounds}] Querying ${availableModels.length} models in parallel...`);

    // Parallel invocation
    const responsePromises = availableModels.map(async (model) => {
      const result = await invokeModel(model, prompt);
      const response: RoundResponse = {
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        content: result.content,
        latencyMs: result.latencyMs,
        error: result.error,
      };
      if (verbose) {
        const status = result.error ? `ERROR: ${result.error}` : `${result.content.length} chars`;
        console.log(`  ${model.name}: ${(result.latencyMs / 1000).toFixed(1)}s — ${status}`);
      }
      return response;
    });

    const responses = await Promise.all(responsePromises);
    const roundDuration = Date.now() - roundStart;

    const deliberationRound: DeliberationRound = {
      round,
      responses,
      timestamp: new Date().toISOString(),
    };
    rounds.push(deliberationRound);

    const successCount = responses.filter((r) => !r.error).length;
    console.log(`  Done in ${(roundDuration / 1000).toFixed(1)}s — ${successCount}/${availableModels.length} responded`);
  }

  // Synthesis (use Claude for final synthesis)
  console.log(`\n[Synthesis] Generating final report...`);
  const synthesisPrompt = buildSynthesisPrompt(question, rounds);
  const synthesisResult = await inference({
    systemPrompt:
      "You are synthesizing a multi-model deliberation. Be objective. Weight each model's contribution by the quality of its reasoning, not its brand. Produce a clear, actionable synthesis.",
    userPrompt: synthesisPrompt,
    level: "smart",
    timeout: 120_000,
  });

  const synthesis = synthesisResult.success
    ? synthesisResult.output
    : `Synthesis failed: ${synthesisResult.error}`;

  const totalDuration = Date.now() - startTime;
  console.log(`\nComplete in ${(totalDuration / 1000).toFixed(1)}s total.`);

  return {
    question,
    rounds,
    synthesis,
    models: availableModels.map((m) => m.name),
    totalDurationMs: totalDuration,
    timestamp: new Date().toISOString(),
  };
}

// --- Research Mode ---

interface ResearchResult {
  question: string;
  responses: RoundResponse[];
  citations: Map<string, string[]>;
  synthesis: string;
  models: string[];
  totalDurationMs: number;
  timestamp: string;
}

function buildResearchPrompt(question: string): string {
  return `RESEARCH QUERY

${question}

Provide a thorough, factual answer. Include:
- Specific facts, names, versions, dates where applicable
- Cite sources or indicate confidence level for each claim
- If you have web search results, integrate them directly
- Distinguish between what you know with high confidence vs what you're less sure about

Be comprehensive but concise. 200-500 words.`;
}

function buildResearchSynthesisPrompt(question: string, responses: RoundResponse[], allCitations: Map<string, string[]>): string {
  const researchData = responses
    .filter(r => !r.error)
    .map(r => {
      const modelCitations = allCitations.get(r.modelId) || [];
      const citationNote = modelCitations.length > 0
        ? `\n[Sources: ${modelCitations.slice(0, 5).join(', ')}]`
        : '';
      return `**${r.modelName}:**\n${r.content}${citationNote}`;
    })
    .join('\n\n---\n\n');

  return `RESEARCH SYNTHESIS

ORIGINAL QUESTION:
${question}

RESEARCH RESPONSES:
${researchData}

---

Synthesize these research responses into a single authoritative answer. Apply these rules:

1. **Cross-check**: Claims appearing in ≥2 sources get HIGH confidence
2. **Single-source claims**: Flag as "reported by [model]" — lower confidence
3. **Contradictions**: Note them explicitly with both positions
4. **Citations**: Include URLs from grounded sources where available
5. **Recency**: Prefer web-grounded (Gemini/Grok) data for time-sensitive claims

Structure your synthesis as:
- **Answer** — Direct answer to the question
- **Key Facts** — Bullet points of verified claims (appear in 2+ sources)
- **Additional Context** — Single-source claims worth noting
- **Sources** — URLs from web-grounded models (if any)

Be authoritative but honest about uncertainty. 200-600 words.`;
}

function formatResearchReport(result: ResearchResult): string {
  const lines: string[] = [];
  lines.push(`# Research: ${result.question}`);
  lines.push('');
  lines.push(`**Date:** ${result.timestamp}`);
  lines.push(`**Models:** ${result.models.join(', ')}`);
  lines.push(`**Duration:** ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('## Individual Responses');
  lines.push('');

  for (const resp of result.responses) {
    if (resp.error) {
      lines.push(`### ${resp.modelName} — ERROR`);
      lines.push(`> ${resp.error}`);
    } else {
      lines.push(`### ${resp.modelName} (${(resp.latencyMs / 1000).toFixed(1)}s)`);
      lines.push(resp.content);
      const modelCitations = result.citations.get(resp.modelId);
      if (modelCitations && modelCitations.length > 0) {
        lines.push('');
        lines.push('**Sources:**');
        for (const url of modelCitations.slice(0, 10)) {
          lines.push(`- ${url}`);
        }
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Synthesis');
  lines.push('');
  lines.push(result.synthesis);
  lines.push('');

  return lines.join('\n');
}

async function research(
  question: string,
  models: ModelConfig[],
  verbose: boolean,
): Promise<ResearchResult> {
  const startTime = Date.now();

  const availableModels = models.filter((m) => {
    if (m.provider === "claude") return true;
    const key = m.envKey ? process.env[m.envKey] : null;
    if (!key) {
      if (verbose) console.error(`  Skipping ${m.name}: missing ${m.envKey}`);
      return false;
    }
    return true;
  });

  if (availableModels.length === 0) {
    throw new Error("No models available. Set at least one API key or ensure Claude CLI is available.");
  }

  console.log(`\n=== Research Mode ===`);
  console.log(`Query: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}`);
  console.log(`Models: ${availableModels.map(m => m.name).join(', ')}`);
  const groundedModels = availableModels.filter(m => m.supportsGrounding);
  if (groundedModels.length > 0) {
    console.log(`Web-grounded: ${groundedModels.map(m => m.name).join(', ')}`);
  }
  console.log('');

  // Scatter: all models answer in parallel with web grounding enabled
  console.log(`[Scatter] Querying ${availableModels.length} models in parallel (web grounding enabled)...`);
  const prompt = buildResearchPrompt(question);
  const allCitations = new Map<string, string[]>();

  const responsePromises = availableModels.map(async (model) => {
    const result = await invokeModel(model, prompt, { grounding: true });
    if (result.citations) {
      allCitations.set(model.id, result.citations);
    }
    const response: RoundResponse = {
      modelId: model.id,
      modelName: model.name,
      provider: model.provider,
      content: result.content,
      latencyMs: result.latencyMs,
      error: result.error,
    };
    if (verbose) {
      const status = result.error ? `ERROR: ${result.error}` : `${result.content.length} chars`;
      const citations = result.citations ? ` (${result.citations.length} citations)` : '';
      console.log(`  ${model.name}: ${(result.latencyMs / 1000).toFixed(1)}s — ${status}${citations}`);
    }
    return response;
  });

  const responses = await Promise.all(responsePromises);
  const successCount = responses.filter(r => !r.error).length;
  console.log(`  Done — ${successCount}/${availableModels.length} responded`);

  // Synthesize: Claude produces final answer
  console.log(`\n[Synthesize] Generating final research report...`);
  const synthesisPrompt = buildResearchSynthesisPrompt(question, responses, allCitations);
  const synthesisResult = await inference({
    systemPrompt: 'You are synthesizing multi-source research. Be factual, cite sources, and clearly distinguish high-confidence claims (multiple sources) from low-confidence ones (single source).',
    userPrompt: synthesisPrompt,
    level: 'smart',
    timeout: 120_000,
  });

  const synthesis = synthesisResult.success
    ? synthesisResult.output
    : `Synthesis failed: ${synthesisResult.error}`;

  const totalDuration = Date.now() - startTime;
  console.log(`\nComplete in ${(totalDuration / 1000).toFixed(1)}s total.`);

  return {
    question,
    responses,
    citations: allCitations,
    synthesis,
    models: availableModels.map(m => m.name),
    totalDurationMs: totalDuration,
    timestamp: new Date().toISOString(),
  };
}

// --- CLI ---

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      mode: { type: "string", default: "debate" },
      rounds: { type: "string", default: "2" },
      models: { type: "string", default: "" },
      output: { type: "string", default: "" },
      config: { type: "string", default: "" },
      verbose: { type: "boolean", default: false },
      "list-models": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: bun deliberate.ts [options] "<question>"

Options:
  --mode <mode>       Execution mode: debate (default) or research
  --rounds <n>        Number of deliberation rounds (default: 2, debate mode only)
  --models <list>     Comma-separated model IDs (default: all available)
                      IDs: claude, gemini, grok, gpt, deepseek, mistral
  --output <path>     Save markdown report to file
  --config <path>     Load custom panel config (JSON)
  --verbose           Show per-model timing and status
  --list-models       Show available models and exit
  --help              Show this help

Modes:
  debate              Multi-round adversarial debate with position revision
  research            Scatter-gather-synthesize with web grounding (single round)

Environment variables:
  GEMINI_API_KEY      Google Gemini API key
  GROK_API_KEY        xAI Grok API key
  OPENAI_API_KEY      OpenAI API key
  DEEPSEEK_API_KEY    DeepSeek API key
  MISTRAL_API_KEY     Mistral AI API key
  (Claude uses PAI Inference — no API key needed)

Examples:
  bun deliberate.ts "Should we migrate from REST to GraphQL?"
  bun deliberate.ts --rounds 3 --models claude,gemini "WebSockets vs SSE?"
  bun deliberate.ts --mode research "What are the latest Claude Code features?"
  bun deliberate.ts --mode research --models gemini,grok "Current state of WebLLM?"
  bun deliberate.ts --output decision.md "Monorepo or polyrepo?"`);
    process.exit(0);
  }

  // Load model panel
  let models = [...DEFAULT_MODELS];
  if (values.config) {
    if (!existsSync(values.config)) {
      console.error(`Config file not found: ${values.config}`);
      process.exit(1);
    }
    const custom = JSON.parse(readFileSync(values.config, "utf-8")) as PanelConfig;
    models = custom.models;
  }

  // Filter models if specified
  if (values.models) {
    const requested = values.models.split(",").map((s) => s.trim().toLowerCase());
    models = models.filter((m) => requested.includes(m.id));
    if (models.length === 0) {
      console.error(`No matching models. Available: ${DEFAULT_MODELS.map((m) => m.id).join(", ")}`);
      process.exit(1);
    }
  }

  if (values["list-models"]) {
    console.log("Available models:\n");
    for (const m of models) {
      const hasKey =
        m.provider === "claude" ? true : m.envKey ? !!process.env[m.envKey] : false;
      const status = hasKey ? "✓ ready" : `✗ missing ${m.envKey}`;
      console.log(`  ${m.id.padEnd(10)} ${m.name.padEnd(20)} ${m.persona.padEnd(14)} ${status}`);
    }
    process.exit(0);
  }

  const question = positionals.join(" ").trim();
  if (!question) {
    console.error('Provide a question: bun deliberate.ts "Your question here"');
    process.exit(1);
  }

  const mode = (values.mode as ExecutionMode) || "debate";
  if (mode !== "debate" && mode !== "research") {
    console.error(`Invalid mode: ${mode}. Use "debate" or "research".`);
    process.exit(1);
  }

  let report: string;

  if (mode === "research") {
    const researchResult = await research(question, models, values.verbose!);
    report = formatResearchReport(researchResult);
  } else {
    const numRounds = parseInt(values.rounds!, 10);
    if (numRounds < 1 || numRounds > 5) {
      console.error("Rounds must be 1-5");
      process.exit(1);
    }
    const result = await deliberate(question, models, numRounds, values.verbose!);
    report = formatReport(result);
  }

  if (values.output) {
    writeFileSync(values.output, report);
    console.log(`\nReport saved to: ${values.output}`);
  }

  // Always print to stdout
  console.log("\n" + report);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
}
