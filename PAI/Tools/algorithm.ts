#!/usr/bin/env bun
/**
 * ============================================================================
 * THE ALGORITHM CLI — Run the PAI Algorithm in Loop or Interactive mode
 * ============================================================================
 *
 * This is a thin wrapper that re-exports the modular implementation.
 * The actual implementation is decomposed into:
 *   - algorithm/types.ts        — Core type definitions
 *   - algorithm/state.ts        — State management and PRD I/O
 *   - algorithm/prompts.ts      — Prompt template builders
 *   - algorithm/parallel.ts     — Parallel agent execution
 *   - algorithm/loop.ts         — Loop mode execution engine
 *   - algorithm/interactive.ts  — Interactive mode
 *   - algorithm/prd.ts          — PRD creation and discovery
 *   - algorithm/cli.ts          — CLI argument parsing
 *   - algorithm/index.ts        — Main orchestrator
 *
 * USAGE:
 *   algorithm -m loop -p <PRD> [-n 128]        Autonomous loop execution
 *   algorithm -m interactive -p <PRD>           Interactive claude session
 *   algorithm new -t <title> [-e <effort>]      Create a new PRD
 *   algorithm status [-p <PRD>]                 Show PRD status
 *   algorithm pause -p <PRD>                    Pause a running loop
 *   algorithm resume -p <PRD>                   Resume a paused loop
 *   algorithm stop -p <PRD>                     Stop a loop
 */

// Re-export everything from the modular implementation
export * from "./algorithm/types";
export * from "./algorithm/state";
export * from "./algorithm/prompts";
export * from "./algorithm/parallel";
export * from "./algorithm/loop";
export * from "./algorithm/interactive";
export * from "./algorithm/prd";
export * from "./algorithm/cli";

// Import the main entry point to execute CLI
import "./algorithm/index";
