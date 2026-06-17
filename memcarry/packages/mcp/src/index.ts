#!/usr/bin/env bun
/**
 * MCP server — what the MODEL calls mid-turn (memory_health + stub memory_resume/memory_write).
 * Phase-0: bootstrap + stdio handshake + health, so the transport/lifecycle is testable before
 * Phase-1 logic lands. Pattern copied from yourcompany-mcp packages/jenkins/src/index.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readAllAtoms, resolveStoreRoot } from "@memcarry/lib";

const STORE = resolveStoreRoot();

process.on("uncaughtException", (err) => {
  process.stderr.write(`[mem-mcp] uncaught: ${err}\n`);
  process.exit(1);
});

const server = new McpServer({ name: "mem", version: "0.0.1" });

server.registerTool(
  "memory_health",
  { description: "Report store health: atom count by type and store path.", inputSchema: {} },
  async () => {
    const atoms = readAllAtoms(STORE);
    const byType: Record<string, number> = {};
    for (const a of atoms) byType[a.type] = (byType[a.type] ?? 0) + 1;
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, store: STORE, atoms: atoms.length, byType }) }] };
  }
);

server.registerTool(
  "memory_resume",
  { description: "(stub) Return the resume-state for a project.", inputSchema: { project: z.string() } },
  async ({ project }) => {
    const r = readAllAtoms(STORE).find((a) => a.type === "resume-state" && a.scope === `project:${project}`);
    return { content: [{ type: "text", text: JSON.stringify(r ?? { found: false }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[mem-mcp] started\n");
