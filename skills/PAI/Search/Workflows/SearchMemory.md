# Search Memory Workflow

## Steps

1. Extract the search query from the user's request (the topic or terms they want to find)
2. Run the MemorySearch tool:
   ```bash
   bun PAI/Tools/MemorySearch.ts "extracted query terms"
   ```
3. Present the results to the user in a readable format
4. If results are empty, suggest checking CONTEXT_ROUTING.md for alternative knowledge sources

## Notes

- Default budget is 4000 chars. Use `--budget N` for more or less.
- Use `--json` flag for structured output when programmatic processing is needed.
- The tool searches across KNOWLEDGE/ (domain summaries) and CAPABILITIES/ (technical capability docs).
- Results are ranked by match density with tag bonus scoring.
- Related notes are followed one hop deep automatically.
