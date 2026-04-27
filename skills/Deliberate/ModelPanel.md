# Model Panel

Default model roster for deliberation. Each model is assigned a deliberation persona that aligns with its known strengths.

## Default Panel

| ID | Model | Provider | Persona | Why This Role |
|----|-------|----------|---------|---------------|
| `claude` | Claude Opus | Anthropic (PAI Inference) | **Architect** | Strong systems reasoning, nuanced trade-off analysis |
| `gemini` | Gemini 2.5 Flash (default) | Google | **Researcher** | Fast, cost-effective evidence synthesis. Escalate to `gemini-2.5-pro` for deep technical analysis. |
| `grok` | Grok 3 | xAI | **Contrarian** | Unfiltered, challenges consensus, stress-tests assumptions |
| `gpt` | GPT-4o | OpenAI | **Pragmatist** | Strong at practical implementation, user-facing concerns |
| `deepseek` | DeepSeek Reasoner | DeepSeek | **Reasoner** | Explicit chain-of-thought, exposes reasoning steps |
| `mistral` | Mistral Large | Mistral AI | **Strategist** | European training, multi-dimensional strategic analysis |

## Persona System Prompts

Each persona gets a system prompt that shapes their deliberation behavior:

- **Architect** — Emphasizes systems thinking, long-term architecture, structural clarity. Direct and precise on trade-offs.
- **Researcher** — Emphasizes evidence, data, real-world precedent. Cites specific examples. Grounds objections in evidence.
- **Contrarian** — Challenges assumptions, points out avoidance, stress-tests popular positions. Values truth over consensus.
- **Pragmatist** — Emphasizes practical implementation, user impact, shipping. Focuses on production reality.
- **Reasoner** — Step-by-step chain-of-thought reasoning. Breaks problems into sub-problems, shows work, exposes logical structure.
- **Strategist** — Strategic analysis across cultural, technical, and business dimensions. Reframes problems to reveal hidden angles.

## Custom Panels

Create a JSON file and pass via `--config`:

```json
{
  "models": [
    {
      "id": "claude-sonnet",
      "name": "Claude (Sonnet)",
      "provider": "claude",
      "model": "sonnet",
      "persona": "Speed Runner",
      "systemPrompt": "You prioritize fast iteration and MVP approaches..."
    },
    {
      "id": "gemini",
      "name": "Gemini Flash",
      "provider": "gemini",
      "model": "gemini-2.0-flash",
      "persona": "Analyst",
      "systemPrompt": "You focus on data analysis and quantitative reasoning...",
      "envKey": "GEMINI_API_KEY"
    }
  ]
}
```

## Adding/Removing Models

- To use only specific models: `--models claude,gemini`
- To check which are available: `--list-models`
- Claude is always available (uses PAI Inference subscription auth)
- External models require their respective API keys in environment
