---
name: task-breakdown
description: Break down PRDs into actionable, atomic tasks with TDD enforcement. Use when user has a PRD and wants to create implementation tasks, or says "break this down", "create tasks", "implement this PRD".
---

# Task Breakdown Skill

## When to Activate

- User says "break down this PRD" or "create tasks from..."
- User has a PRD and wants to start implementation
- User says "implement this feature" (after PRD exists)
- User mentions task creation, work breakdown, or implementation planning

## Execution Rules

- **Deterministic workflow** - no AI agents for core logic
- **TDD enforcement** - every task includes RED → GREEN → REFACTOR cycle
- **Atomic tasks** - each task is independently implementable
- **Dependency tracking** - tasks have explicit dependencies
- **State persistence** - can resume after interruption

## 6-Step State Machine

```
validate-prd → analyze-prd → create-epics → create-approval → create-tasks → verify
```

## Phase 1: Validate PRD

Check PRD structure and atomicity:

1. **File exists and is readable**
2. **Required sections present:**
   - Executive Summary
   - User Stories
   - Functional Requirements (FR-XXX format)
   - Non-Functional Requirements (NFR-XXX format)
3. **Structure validation:**
   - All requirements use `###` header level
   - IDs match FR-XXX or NFR-XXX pattern
   - No intermediate headers between section header and requirements
4. **Atomicity validation:**
   - Max 3 acceptance criteria per requirement
   - Requirements are independently implementable

**If validation fails:**
- Report specific errors
- Suggest user fix PRD or use create-prd skill to regenerate

## Phase 2: Analyze PRD (Deterministic)

Parse PRD and extract:

```javascript
// Analysis output structure
{
  feature: {
    name: string,
    description: string
  },
  userStories: [
    { id: 'US-001', story: string, criteria: [] }
  ],
  functionalReqs: [
    { 
      id: 'FR-001', 
      title: string, 
      description: string,
      acceptanceCriteria: [],
      priority: 'must|should|could|wont',
      estimatedComplexity: 'low|medium|high'
    }
  ],
  nonFunctionalReqs: [
    { id: 'NFR-001', ... }
  ],
  implementationMapping: {
    'FR-001': { files: [], integrationPoints: [], dataModels: [] }
  }
}
```

## Phase 3: Create Epics

Group related requirements into epics:

```
Epic structure:
- Epic: [Feature Area] (e.g., "Authentication System")
  - Related FRs: FR-001, FR-002, FR-003
  - Dependencies: [other epics]
  - Estimated effort: [story points or hours]
```

**Epic grouping criteria:**
- Same functional area
- Same technical component
- Shared dependencies
- Logical implementation sequence

## Phase 4: Create Approval Gate

Generate approval checkpoint:

```markdown
## Task Breakdown Approval Required

**PRD:** {prd-path}
**Feature:** {feature-name}

### Proposed Epics
1. {Epic 1} - {X} tasks
2. {Epic 2} - {Y} tasks
...

**Total Tasks:** {N}
**Estimated Effort:** {duration}

### Dependency Graph
```
[Epic 1] → [Epic 2] → [Epic 3]
   ↓
[Epic 4]
```

### TDD Enforcement
All tasks include:
- RED: Write failing test
- GREEN: Make test pass
- REFACTOR: Clean up code
- SYNTAX: Run formatter
- LINT: Run linter

**To proceed:** User confirms or requests changes
```

## Phase 5: Create Tasks

For each requirement, create atomic tasks:

### Task Structure

```yaml
Task: T-{epic-num}-{task-num}
Title: "[Epic] Implement: {requirement title}"
Requirement: FR-001
Epic: {epic-name}

Description: |
  {requirement description}
  
  Acceptance Criteria:
  {list criteria}

Subtasks:
  - RED: Write failing test for {specific behavior}
  - GREEN: Implement {specific functionality}
  - REFACTOR: Clean up {specific area}
  - SYNTAX: Run formatter on {files}
  - LINT: Run linter on {files}

Dependencies:
  - {task-ids or 'none'}

Files to Modify:
  - {list files from implementation mapping}

Integration Points:
  - {list APIs, DB, external services}

Estimated Time: {X} hours
```

### TDD Gate Enforcement

Every task MUST include these subtasks in order:

1. **RED** - Write failing test
   - Create/update test file
   - Verify test fails (expected behavior)
   - Commit: `test: add failing test for {feature}`

2. **GREEN** - Make test pass
   - Implement minimum code to pass
   - Verify test passes
   - Commit: `feat: implement {feature}`

3. **REFACTOR** - Clean up
   - Improve code quality
   - Remove duplication
   - Verify tests still pass
   - Commit: `refactor: improve {feature} implementation`

4. **SYNTAX** - Format code
   - Run formatter (prettier, black, etc.)
   - Commit: `style: format {files}`

5. **LINT** - Check code quality
   - Run linter (eslint, pylint, etc.)
   - Fix any issues
   - Commit: `style: fix linting in {files}`

### Task Naming Convention

```
T-{epic-num}-{task-num}: [Epic] {action} {component}

Examples:
T-1-1: [Auth] Implement user login endpoint
T-1-2: [Auth] Add password validation
T-2-1: [API] Create database schema
```

## Phase 6: Verify and Summarize

Final validation:

1. **All requirements covered** - every FR/NFR has tasks
2. **No orphaned tasks** - all tasks trace to requirement
3. **Dependency graph valid** - no cycles, all deps resolvable
4. **TDD gates present** - every task has RED→GREEN→REFACTOR→SYNTAX→LINT

### Output Summary

```markdown
# Task Breakdown Complete

**PRD:** {prd-path}
**Total Tasks Created:** {N}
**Total Epics:** {M}

## Epics
1. **{Epic 1}** ({X} tasks)
   - T-1-1: {title}
   - T-1-2: {title}
   
2. **{Epic 2}** ({Y} tasks)
   - T-2-1: {title}
   ...

## Dependency Graph
```
{ascii or mermaid diagram}
```

## Estimated Timeline
- Epic 1: {duration}
- Epic 2: {duration}
- Total: {duration}

## Files Modified
{list all files}

## Next Steps
1. Review tasks and dependencies
2. Claim first task: T-1-1
3. Follow TDD cycle for each subtask
4. Mark complete and move to next

## State File
Tasks saved to: `.pi/tasks/{feature-name}-{date}.json`
Can resume with: `Task breakdown resume from {state-file}`
```

## State Management

### Save State After Each Phase

```json
{
  "sessionId": "td-{timestamp}",
  "prdPath": "...",
  "currentStep": "create-tasks",
  "completedSteps": ["validate-prd", "analyze-prd", "create-epics", "create-approval"],
  "analysis": { ... },
  "epics": [ ... ],
  "tasks": [ ... ],
  "errors": []
}
```

### Resume Capability

If interrupted, can resume:
1. Load state file from `.pi/tasks/`
2. Skip completed steps
3. Continue from current step

## Error Handling

| Error | Action |
|-------|--------|
| PRD not found | Report path, suggest create-prd |
| PRD validation fails | List specific errors, suggest fixes |
| Cycle in dependencies | Report cycle, suggest resolution |
| File write fails | Retry once, then report error |

## Integration with Beads System

Optional integration - if beads is available:

```bash
# Create beads from tasks
br create "T-1-1: {title}" --type task --deps {deps}

# Update status
br update {bead-id} --status in_progress

# Close on completion  
br close {bead-id} --reason "Completed"
```

## Usage Examples

### Basic Usage
```
User: "Break down docs/PRDs/auth-system-20260211.md"
→ Execute full 6-step workflow
```

### Resume
```
User: "Resume task breakdown"
→ Load latest state file, continue
```

### Specific PRD
```
User: "Create tasks from the authentication PRD"
→ Find PRD in docs/PRDs/, execute workflow
```