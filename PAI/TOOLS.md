# PAI Tools — CLI Utilities Reference

Single-purpose CLI utilities in `~/.claude/PAI/Tools/`. Simple utilities don't need separate skills.

**Last Updated:** 2026-04-28 | **Total:** 39 active tools

---

## Core Infrastructure

### pai.ts — PAI CLI
Launch Claude with profile management, dynamic MCP loading, updates, and version checking.
```bash
pai                    # Launch Claude (default profile)
pai -m bd              # Launch with Bright Data MCP
pai upgrade            # Upgrade PAI
pai version            # Show version info
```

### algorithm.ts — Algorithm CLI
Run the PAI Algorithm in loop or interactive mode against PRDs.
```bash
bun algorithm.ts loop PRD.md       # Autonomous iteration
bun algorithm.ts interactive PRD.md # Interactive mode
```

### upgrade.ts — Upgrade Engine
Handles backup, manifest validation, file installation, post-upgrade migration, and auto-rollback. Consumed by `pai.ts upgrade`.

### bump-version.ts — Version Updater
Reads VERSION file as source of truth, updates all known locations.
```bash
bun bump-version.ts                    # Sync all files to VERSION
bun bump-version.ts 4.9.0              # Set new version + sync
bun bump-version.ts 4.9.0 --algo 3.13.0  # Set both versions
```

### GenerateManifest.ts — Release Manifest
Computes SHA-256 checksums for all PAI system files for release validation.

### BuildCLAUDE.ts — CLAUDE.md Generator
Generates CLAUDE.md from template + settings.json variables.

### RebuildPAI.ts — SKILL.md Assembler
Assembles SKILL.md from Components/ directory.

### LoadSkillConfig.ts — Skill Config Loader
Shared utility for loading skill JSON/YAML configs with automatic user customization merging.

### GetCounts.ts — System Counts
Single source of truth for PAI system counts (skills, hooks, workflows, files).

### FeatureRegistry.ts — Feature Tracking
JSON-based feature tracking for complex multi-feature tasks.

---

## AI Inference

### Inference.ts — Unified AI Inference
Single inference tool with three run levels.

| Level | Model | Default Timeout | Use Case |
|-------|-------|-----------------|----------|
| **fast** | Haiku | 15s | Quick tasks, classification |
| **standard** | Sonnet | 30s | Balanced reasoning, analysis |
| **smart** | Opus | 90s | Deep reasoning, strategic decisions |

```bash
bun Inference.ts --level fast "System prompt" "User prompt"
bun Inference.ts --json --level standard "Return JSON" "Input"
```

```typescript
import { inference } from '../PAI/Tools/Inference';
const result = await inference({ systemPrompt: '...', userPrompt: '...', level: 'standard' });
```

---

## Session & Learning

### SessionHarvester.ts — Session Learning Extraction
Harvests insights from `~/.claude/projects/` session transcripts, writes to LEARNING/.

### SessionProgress.ts — Session Continuity
Manages session continuity files for multi-session work.

### ActivityParser.ts — Session Activity Parser
Parses session activity for PAI repo update documentation.

### LearningPatternSynthesis.ts — Rating Aggregation
Analyzes LEARNING/SIGNALS/ratings.jsonl to find recurring patterns and synthesize actionable insights.

### FailureCapture.ts — Failure Analysis
Full context failure analysis system for capturing and learning from errors.

### AlgorithmPhaseReport.ts — Algorithm State Writer
Writes current algorithm state to algorithm-phase.json for status line and monitoring.

---

## Memory & Knowledge

### MemoryCurate.ts — Memory Curation CLI
5-section interactive review for weekly memory curation (3-7 minutes).

### KnowledgeHarvester.ts — Knowledge Extraction
Scans sessions and extracts domain knowledge. Supports `--scan`, `--dry-run`, `--domain`.

### ReflectionHarvester.ts — Behavioral Lessons
Extracts behavioral lessons from algorithm-reflections.jsonl using Jaccard deduplication.

### OpinionTracker.ts — Confidence-Based Opinions
Tracks and evolves confidence-based opinions over time.

### RelationshipReflect.ts — Relationship Growth
Periodic reflection on relationship growth patterns.

### ResearchIndex.ts — Research Catalog
Searchable catalog of prior research across sessions. Two modes: index and search.

---

## Wisdom System

### WisdomDomainClassifier.ts — Request Router
Keyword-based classifier mapping requests to relevant Wisdom Frame files.

### WisdomFrameUpdater.ts — Frame Updater
Takes domain + observation, updates the appropriate Wisdom Frame file.

### WisdomCrossFrameSynthesizer.ts — Cross-Frame Synthesis
Scans all frames for repeated principles, anti-patterns, and predictions.

---

## Media & Transcription

### GetTranscript.ts — YouTube Transcripts
Extract transcripts from YouTube videos using yt-dlp (via fabric).
```bash
bun GetTranscript.ts "https://www.youtube.com/watch?v=VIDEO_ID"
```

### extract-transcript.py — Local Audio/Video Transcription
Local transcription using faster-whisper. Self-contained UV script.
```bash
uv run extract-transcript.py /path/to/audio.m4a
uv run extract-transcript.py video.mp4 --format srt
```

### ExtractTranscript.ts — Whisper API Transcription
CLI for extracting transcripts using OpenAI Whisper API (cloud).

### SplitAndTranscribe.ts — Large File Splitter
Splits large audio files and transcribes them in chunks.

### TranscriptParser.ts — Transcript Parsing Library
Shared library for extracting content from Claude Code transcript files. Used by hooks.

---

## Image Tools

### RemoveBg.ts — Background Removal
Remove backgrounds using the remove.bg API.
```bash
bun RemoveBg.ts /path/to/image.png
bun RemoveBg.ts input.png output.png
```

### AddBg.ts — Add Background Color
Add solid background to transparent images.
```bash
bun AddBg.ts transparent.png "#EAE9DF" output.png
```

---

## APIs & External

### YouTubeApi.ts — YouTube Channel Stats
YouTube Data API v3 wrapper for channel/video statistics.

### SecretScan.ts — Secret Scanning CLI
Scan directories for sensitive information using TruffleHog.

### PreviewMarkdown.ts — Markdown Preview
Opens a markdown file preview in the browser.

---

## Pipeline System

### PipelineOrchestrator.ts — Pipeline Runner
Run pipelines with monitoring and progress tracking.

### PipelineMonitor.ts — Pipeline Dashboard
Real-time WebSocket server + UI for pipeline monitoring.

---

## System Integrity

### IntegrityMaintenance.ts — Background Integrity
Background script for system integrity and update documentation. Receives change data from SystemIntegrity.ts handler.

---

## Display (Legacy)

### Banner.ts — Compact Startup Banner
4-line status summary. Currently unused (status line replaced it).

### BannerMatrix.ts, BannerNeofetch.ts, BannerPrototypes.ts, BannerRetro.ts, BannerTokyo.ts, NeofetchBanner.ts, PAILogo.ts
Legacy banner variants. Candidates for removal (~3,200 lines total).

---

## Adding New Tools

1. Place `.ts` or `.py` in `~/.claude/PAI/Tools/` (Title Case, flat — no subdirectories)
2. Document in this file
3. Test: `bun ~/.claude/PAI/Tools/ToolName.ts --help`
