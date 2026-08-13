---
name: write-pr-body
description: Draft or update a pull request title and body in complete sentences for a reviewer who has not seen the work. Use when creating a PR, filling a PR template, rewriting a PR description, or asked to write pull request text.
---

# Write PR body

Use this skill to produce the pull request title and body. Copy this directory into another agent project as `.agents/skills/write-pr-body/` or `.cursor/skills/write-pr-body/`, or into `~/.agents/skills/write-pr-body/` / `~/.cursor/skills/write-pr-body/` for every repository.

The body is a user-facing message. Write it for a reviewer who has not seen tool calls, internal notes, chat history, or workspace documents. They have the title, the body, and the diff.

## Voice

Communicate directly and concisely, in complete sentences. Concise means being selective about what you include, not clipping the prose: no telegraphic fragments, and no shorthand the reviewer has not already used.

State facts literally. Do not invent metaphors, idioms, or catchy labels to describe the work.

Lead with the change. The first sentence states what landed and why it matters. Supporting detail follows. Open with what is true or what to do. Do not open a paragraph or section with a negation such as "This is not X" or "This PR does not..."; make the point affirmatively, then contrast only if the contrast adds information.

Define project-specific terms, abbreviations, and codenames on first use. Do not carry vocabulary from internal docs, rules, or skills into the body unless the repository or the requester already uses those words.

The body must stand alone: what changed, what the outcome is, and anything a reviewer needs that the diff does not make obvious.

Use formatting sparingly. Bold only the few words that matter most. Use backticks for file, function, and command names.

## What to include

Restate the work in plain language. Do not assume the reviewer remembers an earlier conversation or knows the current state of the branch.

Include, when they are not obvious from the diff:

- The behavior or contract that changed
- Why that change is the right one
- How to verify it, in enough detail to repeat
- Breaking changes, migrations, or follow-up that a reviewer must know

If the repository has a pull request template, fill that template using this voice. Do not invent extra headings around it.

## What to omit

Do not dump file lists, commit logs, test runner transcripts, or raw command output. Give the relevant subset in prose.

Do not mention this skill, writing rules, prompts, or that an agent drafted the text.

Do not wrap the body in HTML comments or other tool metadata. The hosting tool may add those itself.

Do not use a rigid Summary / Test plan / Notes skeleton unless the repository template requires those headings.

## Title

Write an imperative title that names the change, not the process of making it. Prefer "Add Docker sandbox support" over "Created skill" or "Updates for PR guidelines". Keep it specific and shorter than a sentence.

## Examples

A body that leads with the change, then the minimum a reviewer needs:

````markdown
Host-side `sbx mcp` already launches local stdio MCP servers. Put `ROLLBAR_*_ACCESS_TOKEN` in the host environment (the same variables this server already discovers) and register:

```bash
sbx mcp add rollbar --command npx --args "-y,@andreimaxim/rollbar-mcp"
sbx run claude --static-mcp rollbar
```

Prefer the host gateway over starting the server inside the sandbox. All Rollbar environments share `api.rollbar.com`.
````

A body that fails the same rules:

```markdown
## Summary

This PR is not a rewrite of the server. It just adds some docs.

## Changes

- README.md
- various cleanup

## Test plan

- trust me
```
