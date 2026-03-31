---
name: Art
description: Generate illustrations, technical diagrams, mermaid flowcharts, infographics, header images, thumbnails, comics, and PAI pack icons using multiple rendering backends. USE WHEN art, header images, visualizations, mermaid, flowchart, technical diagram, infographic, PAI icon, pack icon, YouTube thumbnails, ad hoc thumbnails, annotated screenshots, aphorisms, comics, comparisons, D3 dashboards, embossed logo wallpaper, essay illustration, frameworks, maps, recipe cards, remove background, stats, taxonomies, timelines, brand wallpaper, visualize, generate image, Midjourney, compose thumbnail, generate prompt.
---

# Art Skill

Complete visual content system for creating illustrations, diagrams, and visual content.

## Customization

**Before executing, check for user customizations at:**
`~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/Art/`

If this directory exists, load and apply:
- `PREFERENCES.md` - Aesthetic preferences, default model, output location
- `CharacterSpecs.md` - Character design specifications
- `SceneConstruction.md` - Scene composition guidelines

These override default behavior. If the directory does not exist, proceed with skill defaults.

2. **Output text notification**:
   ```
   Running the **WorkflowName** workflow in the **Art** skill to ACTION...
   ```

**This is not optional. Execute this curl command immediately upon skill invocation.**

## 🚨🚨🚨 MANDATORY: Output to Downloads First 🚨🚨🚨

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  ALL GENERATED IMAGES GO TO ~/Downloads/ FIRST                   ⚠️
⚠️  NEVER output directly to project directories                    ⚠️
⚠️  User MUST preview in Finder/Preview before use                  ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**This applies to ALL workflows in this skill.**

## Workflow Routing

Route to the appropriate workflow based on the request.

  - Remove background from image → `Workflows/RemoveBackground.md`
  - Brand wallpaper with logo integration → `Workflows/BrandWallpaper.md`
  - YouTube thumbnail checklist → `Workflows/YouTubeThumbnailChecklist.md`
  - Blog header or editorial illustration → `Workflows/Essay.md`
  - D3.js interactive chart or dashboard → `Workflows/D3Dashboards.md`
  - Visualization or unsure which format → `Workflows/Visualize.md`
  - Mermaid flowchart or sequence diagram → `Workflows/Mermaid.md`
  - Technical or architecture diagram → `Workflows/TechnicalDiagrams.md`
  - Taxonomy or classification grid → `Workflows/Taxonomies.md`
  - Timeline or chronological progression → `Workflows/Timelines.md`
  - Framework or 2x2 matrix → `Workflows/Frameworks.md`
  - Comparison or X vs Y → `Workflows/Comparisons.md`
  - Annotated screenshot → `Workflows/AnnotatedScreenshots.md`
  - Recipe card or step-by-step → `Workflows/RecipeCards.md`
  - Aphorism or quote card → `Workflows/Aphorisms.md`
  - Conceptual map or territory → `Workflows/Maps.md`
  - Stat card or big number visual → `Workflows/Stats.md`
  - Comic or sequential panels → `Workflows/Comics.md`
  - YouTube thumbnail (with existing assets) → `Workflows/YouTubeThumbnailChecklist.md`
  - Ad-hoc YouTube thumbnail (generate from content) → `Workflows/AdHocYouTubeThumbnail.md`
  - PAI pack icon → `Workflows/CreatePAIPackIcon.md`

---

## Core Aesthetic

**Default:** Production-quality concept art style appropriate for editorial and technical content.

**User customization** defines specific aesthetic preferences including:
- Visual style and influences
- Line treatment and rendering approach
- Color palette and wash technique
- Character design specifications
- Scene composition rules

**Load from:** `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/Art/PREFERENCES.md`

---

## Reference Images

**User customization** may include reference images for consistent style.

Check `~/.claude/PAI/USER/SKILLCUSTOMIZATIONS/Art/PREFERENCES.md` for:
- Reference image locations
- Style examples by use case
- Character and scene reference guidance

**Usage:** Before generating images, load relevant user-provided references to match their preferred style.

---

## Image Generation

**Default model:** Check user customization at `SKILLCUSTOMIZATIONS/Art/PREFERENCES.md`
**Fallback:** nano-banana-pro (Gemini 3 Pro)

### Model-Specific Size Requirements

Each model accepts different `--size` formats. Using the wrong format causes validation errors.

| Model | `--size` format | Valid values | Default |
|-------|----------------|--------------|---------|
| `flux` | Aspect ratio | `1:1`, `16:9`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `21:9` | `16:9` |
| `nano-banana` | Aspect ratio | `1:1`, `16:9`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `21:9` | `16:9` |
| `nano-banana-pro` | Resolution tier | `1K`, `2K`, `4K` (also accepts `--aspect-ratio` separately) | `2K` |
| `gpt-image-1` | Pixel dimensions | `1024x1024`, `1536x1024`, `1024x1536` | `1024x1024` |

**Note:** `nano-banana-pro` uses `--size` for resolution quality and a separate `--aspect-ratio` flag for aspect ratio (defaults to `16:9`).

### 🚨 CRITICAL: Always Output to Downloads First

**ALL generated images MUST go to `~/Downloads/` first for preview and selection.**

Never output directly to a project's `public/images/` directory. User needs to review images in Preview before they're used.

**Workflow:**
1. Generate to `~/Downloads/[descriptive-name].png`
2. User reviews in Preview
3. If approved, THEN copy to final destination (e.g., `cms/public/images/`)
4. Create WebP and thumbnail versions at final destination

```bash
# CORRECT - Output to Downloads for preview
bun run ~/.claude/skills/Media/Art/Tools/Generate.ts \
  --model nano-banana-pro \
  --prompt "[PROMPT]" \
  --size 2K \
  --aspect-ratio 1:1 \
  --thumbnail \
  --output ~/Downloads/blog-header-concept.png

# After approval, copy to final location
cp ~/Downloads/blog-header-concept.png ${PROJECTS_DIR}/YourWebsite/cms/public/images/
cp ~/Downloads/blog-header-concept-thumb.png ${PROJECTS_DIR}/YourWebsite/cms/public/images/
```

### Multiple Reference Images (Character/Style Consistency)

For improved character or style consistency, use multiple `--reference-image` flags:

```bash
# Multiple reference images for better likeness
bun run ~/.claude/skills/Media/Art/Tools/Generate.ts \
  --model nano-banana-pro \
  --prompt "Person from references at a party..." \
  --reference-image face1.jpg \
  --reference-image face2.jpg \
  --reference-image face3.jpg \
  --size 2K \
  --aspect-ratio 16:9 \
  --output ~/Downloads/character-scene.png
```

**API Limits (Gemini):**
- Up to 5 human reference images
- Up to 6 object reference images
- Maximum 14 total reference images per request

**API keys in:** `${PAI_DIR}/.env`

## Examples

**Example 1: Blog header image**
```
User: "create a header for my AI agents post"
→ Invokes ESSAY workflow
→ Generates charcoal sketch prompt
→ Creates image with architectural aesthetic
→ Saves to ~/Downloads/ for preview
→ After approval, copies to public/images/
```

**Example 2: Technical architecture diagram**
```
User: "make a diagram showing the SPQA pattern"
→ Invokes TECHNICALDIAGRAMS workflow
→ Creates structured architecture visual
→ Outputs PNG with consistent styling
```

**Example 3: Comparison visualization**
```
User: "visualize humans vs AI decision-making"
→ Invokes COMPARISONS workflow
→ Creates side-by-side visual
→ Charcoal sketch with labeled elements
```

**Example 4: PAI pack icon**
```
User: "create icon for the skill system pack"
→ Invokes CREATEPAIPACKICON workflow
→ Reads workflow from Workflows/CreatePAIPackIcon.md
→ Generates 1K image with --remove-bg for transparency
→ Resizes to 256x256 RGBA PNG
→ Outputs to ~/Downloads/ for preview
→ After approval, copies to ${PROJECTS_DIR}/PAI/Packs/icons/
```
