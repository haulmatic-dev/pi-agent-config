---
name: create-prd
description: Create a comprehensive Product Requirements Document (PRD). Use when user describes a new feature, says "I want to build", "let's add", "create PRD", "design a system", or needs requirements documentation.
---

# Create PRD Skill

## When to Activate

- User says "create a PRD for..."
- User describes a feature: "I want to build..."
- User says "let's design..." or "let's plan..."
- User asks for requirements documentation
- User mentions PRD, specifications, or planning
- User describes a new feature idea

## Execution Rules

- **DO NOT** ask "should I proceed?" or "is this correct?"
- **Automatically** execute all phases sequentially
- **Only stop** for critical errors or user explicit cancellation
- **Ask clarifying questions** only if requirements are unclear (max 2-3)

## Phase 1: Requirements Gathering

Extract from user input:
1. What is the core problem/feature?
2. Who are the users?
3. Any specific technical constraints?

**Output:** Clear feature description and feature name

## Phase 2: Research (Always Required)

Spawn 6 research subagents in **parallel** using pi's subagent tool.

**Prerequisites:** Ensure the subagent extension is enabled. If not available, install it from pi examples or run research agents sequentially.

### Parallel Execution

Use pi's subagent tool with PARALLEL mode (max 4 concurrent, 8 total):

```
subagent: {
  tasks: [
    {
      agent: "codebase-researcher",
      task: "Research codebase architecture and patterns for: {feature-description}. Look at existing similar features, code organization, and design patterns used."
    },
    {
      agent: "context-researcher",
      task: "Research project context and existing systems for: {feature-description}. Find related documentation, config files, and integration points."
    },
    {
      agent: "git-history-analyzer",
      task: "Analyze git history for similar features or patterns related to: {feature-description}. Look at recent commits, PRs, and feature implementations."
    },
    {
      agent: "best-practices-researcher",
      task: "Research industry best practices for: {feature-description}. Include standard approaches, common pitfalls, and recommended patterns."
    },
    {
      agent: "library-source-reader",
      task: "Research library capabilities and constraints for: {feature-description}. Check package.json, dependencies, and framework versions."
    },
    {
      agent: "domain-specialist",
      task: "Research domain-specific requirements for: {feature-description}. Include business rules, user expectations, and compliance needs."
    }
  ]
}
```

### Agent Definitions

Agents are defined in `~/.pi/agent/agents/`:
- `codebase-researcher.md` - Fast codebase recon (read, bash tools)
- `context-researcher.md` - Documentation and context (read, bash, mcp tools)
- `git-history-analyzer.md` - Git history analysis (read, bash tools)
- `best-practices-researcher.md` - Industry standards (read, mcp tools)
- `library-source-reader.md` - Dependency analysis (read tool)
- `domain-specialist.md` - Domain requirements (read, mcp tools)

All use `claude-haiku-4-5` for fast, cost-effective research.

### Collect Results

Aggregate findings into structured research context:

```javascript
researchContext = {
  codebaseFindings: { /* from codebase-researcher */ },
  contextFindings: { /* from context-researcher */ },
  historyFindings: { /* from git-history-analyzer */ },
  bestPractices: { /* from best-practices-researcher */ },
  libraryCapabilities: { /* from library-source-reader */ },
  domainKnowledge: { /* from domain-specialist */ },
  completed: [/* agent names that finished */],
  errors: [/* any failures */]
}
```

**Parallel Execution Benefits:**
- All 6 agents run concurrently (4 at a time)
- Real-time streaming of progress
- Automatic aggregation when all complete
- Total time ~2-3 minutes vs ~10-15 minutes sequential

## Phase 3: PRD Generation

Generate PRD with structure and atomicity enforcement:

### Structure Rules (MANDATORY)

✅ **CORRECT FORMAT:**
```markdown
### FR-001: Requirement Title
Description of what this requirement does.

**Acceptance Criteria:**
- First criterion without any ID prefix
- Second criterion (max 3 total)
- Third criterion if needed
```

❌ **INCORRECT FORMATS:**
- `#### FR1: Title` (wrong header level)
- `### FR-1.1: Sub-requirement` (subsections not allowed)
- `- FR1.1: Criterion text` (ACs should not have IDs)
- `### 3.1 Category` (intermediate headers not allowed)

### Atomicity Rules
- Max 3 acceptance criteria per requirement
- 4-6 ACs = Split into 2 requirements
- 7+ ACs = Split into 3+ requirements

### PRD Template

```markdown
# Product Requirements Document: {Feature Name}

## 1. Executive Summary
- Feature overview
- Business value
- Success metrics

## 2. User Stories
As a [user], I want [goal] so that [benefit]

## 3. Functional Requirements

### FR-001: [Requirement Title]
[Description]

**Acceptance Criteria:**
- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

### FR-002: [Next Requirement]
...

## 4. Non-Functional Requirements

### NFR-001: [Performance/Security/etc]
...

## 5. Technical Considerations
- Architecture approach
- Technology choices
- Project structure
- Configuration

### 5.8 Implementation Mapping

| Requirement | Files | Integration Points | Data Models |
|-------------|-------|-------------------|-------------|
| FR-001 | `src/module.ts` | API endpoint | ModelName |

## 6. Risks and Mitigation
- Technical risks
- Business risks
- Mitigation strategies

## 7. MoSCoW Prioritization
- Must have
- Should have
- Could have
- Won't have

## 8. Success Metrics
- KPIs
- Measurement approach
- Target values

## 9. Research Insights
- Codebase patterns found
- Historical context
- Best practices identified
- Domain expertise applied
```

## Phase 4: Save and Report

### Generate Filename
```
Format: docs/PRDs/{feature-name}-{YYYYMMDD}{-vN}.md

Examples:
- analytics-dashboard-20260211.md
- payment-system-20260211-v2.md
```

### Check for Existing
- List files in docs/PRDs/ matching pattern
- If exists → increment suffix (v2, v3, etc.)
- Never overwrite

### Save PRD
- Create docs/PRDs/ directory if not exists
- Write PRD to generated filename
- Verify file was created

### Report to User
```
PRD created successfully!

File: docs/PRDs/{filename}.md
Size: {size} bytes
Lines: {line count}

The PRD includes:
- Executive summary
- User stories with acceptance criteria
- Functional and non-functional requirements
- Technical considerations based on codebase research
- Risk assessment with mitigation strategies
- MoSCoW prioritization
- Success metrics

Research agents consulted: 6
- codebase-researcher ✓
- context-researcher ✓
- git-history-analyzer ✓
- best-practices-researcher ✓
- library-source-reader ✓
- domain-specialist ✓

Next steps:
1. Review the PRD at docs/PRDs/{filename}.md
2. Edit or refine as needed
3. Use task-breakdown skill when ready to implement
```

## Error Handling

### Research Failures
- **Partial Failure** (1-5 agents fail): Continue with available research, note failures in PRD
- **Complete Failure** (all 6 fail): ERROR - "Cannot create PRD without research context"

### Validation Failures
- Auto-fix structure issues when possible
- Split requirements exceeding atomicity limits
- If unfixable: report specific errors and exit

## Integration Notes

- This skill ONLY creates PRDs - does NOT generate tasks or start implementation
- Task breakdown is handled by separate `task-breakdown` skill
- PRDs are versioned and never overwritten
- Research findings inform all sections of the PRD