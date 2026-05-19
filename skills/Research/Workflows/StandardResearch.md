# Standard Research Workflow

**Mode:** 2 different researcher types, 1 query each | **Timeout:** 1 minute

## 🚨 CRITICAL: URL Verification Required

**BEFORE delivering any research results with URLs:**
1. Verify EVERY URL using WebFetch or curl
2. Confirm the content matches what you're citing
3. NEVER include unverified URLs - research agents HALLUCINATE URLs
4. A single broken link is a CATASTROPHIC FAILURE

See `SKILL.md` for full URL Verification Protocol.

## When to Use

- Default mode for most research requests
- User says "do research" or "research this"
- Need multiple perspectives quickly

## Workflow

### Step 0a: Check Research Index (MANDATORY)

**Before launching any agents**, check if this topic was already researched:

```bash
bun ~/.claude/PAI/Tools/ResearchIndex.ts dedup "<research topic>"
```

- If `duplicate: true` — show the prior research summary to the user. Ask: "This was researched on [date]. Want me to research again or use these findings?"
  - If user says use prior: skip to Step 5 with the cached summary
  - If user says re-research: continue to Step 0b, but seed agents with the prior summary as context (add to their prompts: "Prior research found: [summary]. Build on or update these findings.")
- If `duplicate: false` — continue normally

### Step 0b: Check Local Context FIRST (MANDATORY)

**Before launching any web research agents**, check if the topic relates to known local projects in your knowledge base, or any known project. If so:

1. Read `CONTEXT_ROUTING.md` for relevant local paths
2. Read `~/Projects/Knowledge/INDEX.md` and search for topic keywords
3. Check relevant GitHub repos via `gh` CLI (issues, docs)
4. Launch an **Explore agent** to search local project files IN PARALLEL with web agents (not after)

**Why:** The user may have a local knowledge base with indexed docs, architecture notes, and project context. Web research agents are slow and the information may not be public. Local context is faster and more accurate.

**If local context covers >80% of the answer**, skip web agents entirely and synthesize from local sources.

### Step 1: Craft One Query Per Researcher

Create ONE focused query optimized for each researcher's strengths:
- **Claude**: Academic depth, detailed analysis, scholarly sources
- **Gemini**: Multi-perspective synthesis, cross-domain connections

### Step 2: Launch 2 Agents in Parallel (1 of each type)

**SINGLE message with 2 Task calls:**

```typescript
Task({
  subagent_type: "ClaudeResearcher",
  description: "[topic] analysis",
  prompt: "Do ONE search for: [query optimized for depth/analysis]. Return findings immediately."
})

Task({
  subagent_type: "GeminiResearcher",
  description: "[topic] perspectives",
  prompt: "Do ONE search for: [query optimized for breadth/perspectives]. Return findings immediately."
})
```

**Each agent:**
- Gets ONE query
- Does ONE search
- Returns immediately

### Step 3: Quick Synthesis

Combine the two perspectives:
- Note where they agree (high confidence)
- Note unique contributions from each
- Flag any conflicts

### Step 4: VERIFY ALL URLs (MANDATORY)

**Before delivering results, verify EVERY URL:**

```bash
# For each URL returned by agents:
curl -s -o /dev/null -w "%{http_code}" -L "URL"
# Must return 200

# Then verify content:
WebFetch(url, "Confirm article exists and summarize main point")
# Must return actual content, not error
```

**If URL fails verification:**
- Remove it from results
- Find alternative source via WebSearch
- Verify the replacement URL
- NEVER include unverified URLs

### Step 5: Return Results

```markdown
📋 SUMMARY: Research on [topic]
🔍 ANALYSIS: [Key findings from 2 perspectives]
⚡ ACTIONS: 2 researchers × 1 query each
✅ RESULTS: [Synthesized answer]
📊 STATUS: Standard mode - 2 agents, 1 query each
📁 CAPTURE: [Key facts]
➡️ NEXT: [Suggest extensive if more depth needed]
📖 STORY EXPLANATION: [5-8 numbered points]
🎯 COMPLETED: Research on [topic] complete
```

### Step 6: Save to Research Index (MANDATORY)

After delivering results, capture this research for future sessions:

```bash
bun ~/.claude/PAI/Tools/ResearchIndex.ts save \
  --topic "<research topic>" \
  --summary "<2-3 sentence synthesis of key findings>" \
  --agents "ClaudeResearcher,GeminiResearcher" \
  --keywords "<comma-separated key terms>" \
  --quality <1-10 based on source quality and coverage> \
  --sources "<comma-separated verified URLs>"
```

This builds the institutional knowledge base so future research can build on prior findings.

## Speed Target

~15-30 seconds for results
