# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**@torgon/mule** is a minimal, type-safe workflow engine for Deno that supports sequential, parallel, and conditional (branch) step execution. The library provides a fluent API for building workflows with automatic output chaining between steps, Zod schema validation, and state management.

## Development Commands

### Running Tests
```bash
deno test
```

Run a single test file:
```bash
deno test main_test.ts
```

Run a specific test:
```bash
deno test --filter "Workflow - single step execution"
```

### Development Mode
```bash
deno task dev
```

### Publishing
The package is published to JSR as `@torgon/mule`. Version is managed in [deno.json](deno.json).

## Architecture

### Core Components

**[main.ts](main.ts)** contains the entire implementation:

1. **`Step<TInput, TOutput, TState, TId>`** - Type definition for workflow steps with:
   - `id`: Unique string identifier
   - `inputSchema`: Zod schema for input validation
   - `outputSchema`: Zod schema for output validation
   - `executor`: Async function receiving `{ input, state }` and returning output

2. **`createStep()`** - Factory function that creates typed workflow steps with full TypeScript inference

3. **`Workflow<TCurrentOutput>`** - Main workflow class that:
   - Chains steps sequentially via `addStep()`
   - Executes steps in parallel via `parallel()`
   - Supports conditional execution via `branch()`
   - Manages shared state across all steps via `this.state`
   - Passes output from one step as input to the next via `this.lastOutput`
   - Uses a promise chain (`this.promise`) for sequential execution control

4. **`createWorkflow()`** - Factory function for creating workflow instances with initial state and input schema

### Type System

The workflow uses TypeScript's type inference to:
- Track the output type of the current step (`TCurrentOutput`)
- Ensure the next step's input type matches the previous step's output type
- Infer parallel step results as an object with keys from step IDs
- Preserve type safety through the entire workflow chain

### Execution Model

- **Sequential**: Steps added via `addStep()` execute one after another, with each step receiving the previous step's output
- **Parallel**: Steps in `parallel()` all receive the same input and execute concurrently. Results are returned as an object keyed by step ID
- **Branch**: Steps in `branch()` are conditionally executed based on predicates. All steps with true conditions run in parallel. Results are returned as an object keyed by step ID (empty object if no conditions match)
- All step execution happens within a promise chain that resolves when `run()` is called

### State Management

- `workflow.state` is a mutable object shared across all steps
- Steps can read from and write to state via the `state` parameter
- State persists across sequential, parallel, and branch steps
- Initial state can be passed to the `Workflow` constructor or `createWorkflow()`

### Key Implementation Details

- The workflow maintains a promise chain that accumulates all step executions
- `run()` awaits the promise chain and returns the workflow instance
- Parallel steps execute concurrently but their results are stored synchronously after all complete
- Branch steps filter by condition first, then execute matching steps in parallel
- Type casting (`as any`) is used strategically to work around TypeScript's limitations with fluent APIs
