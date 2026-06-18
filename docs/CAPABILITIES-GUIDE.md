# KAI Capabilities Guide

What KAI can do, organized by how often you'll reach for it.

## Tier 1 — Daily Drivers

These are the capabilities you'll use most sessions. Learn these first.

| Command | What It Does | When to Use |
|---------|-------------|-------------|
| `/research` | Multi-agent parallel research across 6 AI models (Claude, Gemini, Grok, DeepSeek, Mistral, Perplexity). Decomposes queries, runs parallel searches, synthesizes into structured reports. | Any time you need to know something beyond the codebase — technology decisions, market research, competitor analysis, how-to questions |
| `/devteam` | Spins up autonomous agent teams (PM + Dev + QA) that scope, implement, and verify work. Supports bug-fix, feature, and investigation presets with adaptive retry. | Fix a bug end-to-end, build a feature, or investigate a root cause without hand-holding each step |
| `/deliberate` | Multi-model deliberation via AWS Bedrock (DeepSeek, Mistral, Llama) or Claude adversarial review. Models debate and reach consensus. | Architecture decisions, code review, document review, any "should we do X or Y?" question |
| `/end` | Session wrap-up: saves memories, updates knowledge, syncs PRDs, reports git status. | End of every working session |
| `/media` | Visual content: images (Flux, GPT-Image-1), diagrams (Mermaid), infographics, video (Remotion). | Need a header image, architecture diagram, flowchart, or any visual |
| `/browser` | Headless browser automation via Playwright. Navigate, click, fill forms, screenshot, extract data. | Test a UI, scrape a page, automate a workflow, verify a deployment |

## Tier 2 — Weekly / Situational

These solve specific problems well. You'll reach for them when the situation fits.

| Command | What It Does | When to Use |
|---------|-------------|-------------|
| `/investigation` | Deep-dive debugging with lead + researcher agents. Root cause analysis, evidence gathering, hypothesis testing. | "Why is this happening?" — when you need to understand, not just fix |
| `/security` | Full security toolkit: network recon, web app assessment, prompt injection testing, vulnerability analysis. | Pentesting, security audits, threat modeling, CTF challenges |
| `/documents` | Process PDF, DOCX, PPTX, XLSX files. Extract content, summarize, analyze. | Need to work with files Claude can't normally read |
| `/scraping` | Progressive web scraping: direct fetch, Bright Data proxy, Apify actors. Handles bot detection, CAPTCHAs, social media. | Scrape sites that block basic requests, social media data extraction |
| `/extractwisdom` | Content-adaptive extraction from videos, podcasts, articles. Identifies what's novel and interesting. | "What did I miss in this talk/podcast/article?" |
| `/evolve` | Self-improvement: analyzes PAI system and proposes enhancements based on usage patterns. | When KAI needs to learn new patterns or fix system issues |
| `/telos` | Life OS: goals, projects, dependencies, beliefs, wisdom tracking. McKinsey-style reports and dashboards. | Project planning, goal review, life strategy |
| `/weeklystatus` | Auto-generates leadership status updates from active PRDs and project state. | Weekly status report time |
| `/oneonone` | 1:1 meeting notes, performance review prep, theme tracking across conversations. | Before/after meetings with direct reports |

## Tier 3 — Specialized

Powerful but narrow. You'll know when you need them.

| Command | What It Does | When to Use |
|---------|-------------|-------------|
| `/thinking` | Extended reasoning modes: `/council` (multi-agent debate), `/firstprinciples` (decomposition), `/redteam` (32 adversarial agents), `/iterativedepth` (multi-angle exploration) | Deep analysis requiring different thinking frameworks |
| `/fabric` | 240+ specialized prompt patterns (from Daniel Miessler's Fabric). Content analysis, extraction, transformation. | When a specific Fabric pattern fits your need |
| `/science` | Scientific method applied to technical questions. Hypothesis, experiment, evidence, conclusion. | Rigorous investigation where you need provable answers |
| `/usmetrics` | 68 US economic indicators from FRED, EIA, Treasury, BLS, Census. Trend analysis and correlation. | Economic research, market context |
| `/secupdates` | Security news monitoring and analysis. Breach reports, CVEs, research papers. | Staying current on security landscape |
| `/wikiquery` | Query the YourCompany Engineering Wiki (81 pages of firmware, build, Jenkins knowledge). | Domain-specific technical questions |
| `/worldthreatmodelharness` | Adversarial analysis across 11 time horizons (6mo to 50yr). | Stress-testing strategies, investments, or decisions against future scenarios |
| `/evals` | Agent evaluation framework: code-based/model-based/human graders, pass@k metrics. | Testing agent behavior, regression testing |
| `/promptinjection` | LLM security testing: jailbreak attempts, guardrail bypass, injection vectors. | Security assessment of AI applications |
| `/development` | Spec-driven development: write specs before code, generate ISC criteria, track status. | When you want formal specs before implementation |

## Agents (20 Available)

Agents are specialized roles spawned by skills like `/devteam` and `/deliberate`. You can also reference them directly by name.

| Agent | Specialty |
|-------|-----------|
| **Architect** | System design, distributed systems, architecture decisions |
| **Engineer** | Implementation, TDD, Fortune-10-level code quality |
| **Designer** | UX/UI, Figma concepts, accessibility, shadcn/ui |
| **Pentester** | Offensive security, vulnerability assessment |
| **QATester** | Browser-based verification, user story validation |
| **Artist** | Image generation, prompt engineering for visual models |
| **BrowserAgent** | Parallel headless browser automation |
| **6 Researchers** | Claude, Gemini, Grok, DeepSeek, Mistral, Perplexity — each with unique strengths and perspectives |
| **ProductStrategist** | Roadmap, feature trade-offs, competitive positioning |
| **StakeholderCommunicator** | Executive updates, cross-functional messaging, risk framing |
| **TechnicalReviewer** | Architecture proposals, risk spotting, right questions to ask |
| **UIReviewer** | User story validation with Playwright screenshots |
| **Intern** | High-IQ generalist for complex multi-faceted problems |

## Hooks (53 Active)

Hooks run automatically at lifecycle events. You don't invoke these — they fire on their own.

| Category | Examples | What They Do |
|----------|----------|-------------|
| **Security** | SecretScanner, SecretOutputDetector, GitHubWriteGuard, SecurityValidator, WebFetchGuard | Block secrets from leaking, gate pushes, validate URLs |
| **Memory** | MemoryRecall, MemoryTimeline, InsightExtractor, RelationshipMemory, KnowledgeSync | Auto-recall relevant context, track relationships, extract learnings |
| **Quality** | FormatReminder, PromptAnalysis, ModeClassifier | Enforce output format, classify request complexity |
| **Lifecycle** | SessionEndComposite, StartupGreeting, WeeklyMaintenance | Session bookends, knowledge freshness, periodic maintenance |
| **Analytics** | ReadTracker, WriteTracker, AlgorithmTracker, RatingCapture | Track what's read/written, algorithm performance |

## The Algorithm (v3.14.0)

KAI's core reasoning engine. Activated automatically for complex, multi-step work.

- **Loop mode** — Autonomous iteration against PRD criteria until all pass or plateau detected
- **Interactive mode** — Human-in-the-loop with structured OODA-V phases (Observe, Orient, Decide, Act, Verify)
- **Meta-cognitive monitor** — 12 policy checks that catch common mistakes in real-time
- **Planning observer** — Tracks divergence between expected and actual progress, triggers replanning
- **Parallel execution** — Multiple agents working on different criteria simultaneously

## DevTeam Intelligence (v6.6.0)

The `/devteam` orchestrator includes:

- **Cost tracking** — Per-phase token cost with soft/hard budget limits
- **Stall detection** — Kills agents that stop producing output (60s/120s thresholds)
- **Adaptive retry** — Critical issues always retry; Standard retries once; Minor defers to report
- **Checkpointing** — Saves phase state so interrupted runs can resume
- **Conditional execution** — Skip review phase if cost is under threshold

## Infrastructure

| Component | Command | What It Does |
|-----------|---------|-------------|
| **KAI Board** | `bun scripts/board.ts` | Web dashboard on :3333 — algorithm state, sessions, PRD progress |
| **Config system** | `$EDITOR config/*.jsonc` | 7 domain files that compile to settings.json |
| **Build settings** | `bun hooks/handlers/BuildSettings.ts` | Rebuild settings.json from domain configs |
| **Sync pipeline** | `bash scripts/sync-to-kai.sh` | Private repo to public repo sync with PII scrubbing |
| **Deploy** | `bun scripts/deploy.ts` | Package for distribution |
