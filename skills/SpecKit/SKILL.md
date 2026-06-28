---
name: SpecKit
description: Spec-driven development accelerator for turning ideas into specs, plans, task lists, implementations, and validation loops. USE WHEN speckit, spec kit, specification kit, write a spec, create a plan from a spec, derive tasks, implement from tasks, spec-driven development, clarify requirements, validate a plan against a spec.
---

# SpecKit

SpecKit turns an idea into an executable development path:

1. Clarify requirements and constraints.
2. Write a compact feature spec.
3. Produce an implementation plan.
4. Break the plan into ordered tasks.
5. Implement against the task list.
6. Validate the result against the original spec.

This skill complements the KAI Algorithm and the `Development` skill. Use SpecKit when the user wants a
structured design-to-implementation flow, especially for work with unclear requirements or several dependent
steps.

## Workflow Routing

| Request Pattern | Route To |
|---|---|
| Clarify an idea before writing requirements | `Workflows/Clarify.md` |
| Write a spec, create requirements, define acceptance criteria | `Workflows/Spec.md` |
| Turn a spec into an implementation plan | `Workflows/Plan.md` |
| Break a plan into ordered implementation tasks | `Workflows/Tasks.md` |
| Implement from tasks/spec | `Workflows/Implement.md` |
| Validate implementation against spec/tasks | `Workflows/Validate.md` |

## Operating Rules

- Keep specs short enough to execute from.
- Capture open questions explicitly instead of inventing answers.
- Use existing project conventions before introducing new structure.
- Treat tests, release gates, and public/private sync boundaries as first-class criteria.
- Preserve a trace from idea -> spec -> plan -> tasks -> implementation -> validation.
