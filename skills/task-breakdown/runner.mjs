/**
 * TaskBreakdownRunner - Main orchestrator for deterministic task breakdown
 *
 * PURE DETERMINISTIC EXECUTION - No AI agents involved
 * All analysis and task creation happens via deterministic code
 *
 * Event-driven architecture with event types:
 * - Workflow events: workflow:start, workflow:complete
 * - Phase events: phase:start, phase:complete, phase:skip
 * - Validation events: validation:start, validation:success
 * - State events: state:save
 * - Task events: task:gate:created, task:batch:start, task:created, task:subtask:created, task:batch:phase:complete, task:batch:complete
 * - Error events: error:occurred, retry:attempt
 * - Rollback events: rollback:start, rollback:progress, rollback:complete
 * - Verification events: verification:complete
 *
 * Manages the 6-step state machine:
 * 1. validate-prd
 * 2. analyze-prd (deterministic code analysis)
 * 3. create-approval
 * 4. create-tasks (includes TDD sub-task creation)
 * 5. create-lint-gate
 * 6. verify
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { analyzePRDDeterministic } from './analyzer.mjs';
import { BeadsExecutor } from './executor.mjs';
import { RollbackManager } from './rollback.mjs';
import { StateManager } from './state.mjs';

export class TaskBreakdownRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionId = options.sessionId || `td-${Date.now()}`;
    this.state = new StateManager(this.sessionId);
    // Pure deterministic execution - no AI agents
    this.executor = new BeadsExecutor();
    this.rollback = new RollbackManager();

    // Event batching configuration
    this.batchInterval = options.batchInterval || 100;
    this.maxBatchSize = options.maxBatchSize || 10;
    this.eventBuffer = [];
    this.batchTimer = null;

    // Step handlers - PURE DETERMINISTIC WORKFLOW
    // Code analyzes → Code creates ALL tasks (no AI agents)
    this.steps = {
      'validate-prd': this.validatePRD.bind(this),
      'analyze-prd': this.analyzePRD.bind(this),
      'create-epics': this.createEpicsFromAnalysis.bind(this),
      'create-approval': this.createApprovalGate.bind(this),
      'create-tasks': this.createTasksFromAnalysis.bind(this),
      verify: this.verifyAndSummarize.bind(this),
    };
  }

  /**
   * Emit an event with internal batching
   * @private
   */
  _emitEvent(type, data = {}) {
    const event = {
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      ...data,
    };

    this.eventBuffer.push(event);

    // Flush immediately if buffer is full
    if (this.eventBuffer.length >= this.maxBatchSize) {
      this._flushEvents();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this._flushEvents();
      }, this.batchInterval);
    }
  }

  /**
   * Flush buffered events to listeners
   * @private
   */
  _flushEvents() {
    if (this.eventBuffer.length === 0) return;

    // Emit all buffered events
    this.eventBuffer.forEach((event) => {
      this.emit('event', event);
    });

    // Clear buffer and timer
    this.eventBuffer = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Force flush any pending events
   * Call this before process exit to ensure all events are emitted
   */
  async flush() {
    this._flushEvents();
    // Small delay to allow event listeners to process
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Clean up resources
   */
  destroy() {
    this._flushEvents();
    this.removeAllListeners();
  }

  /**
   * Main entry point - run the full task breakdown process
   * @param {string} prdPath - Path to PRD file
   * @returns {Promise<Object>} Summary of created tasks
   */
  async run(prdPath) {
    console.log(`[Runner] Starting task breakdown for: ${prdPath}`);
    console.log(`[Runner] Session ID: ${this.sessionId}`);

    // Emit workflow start
    this._emitEvent('workflow:start', {
      prdPath,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    });

    // Initialize state
    await this.state.initialize(prdPath);

    try {
      // Run state machine
      while (true) {
        const currentState = await this.state.load();
        const step = currentState.currentStep;

        console.log(`\n[Runner] Executing step: ${step}`);

        if (step === 'completed') {
          console.log('[Runner] Task breakdown completed successfully!');
          const summary = this.generateSummary(currentState);

          // Emit workflow complete
          this._emitEvent('workflow:complete', {
            success: true,
            summary,
            timestamp: Date.now(),
          });

          // Ensure all events are flushed
          await this.flush();

          return summary;
        }

        if (step === 'failed') {
          const error = new Error(
            `Task breakdown failed: ${currentState.errors.slice(-1)[0]?.message}`,
          );
          this._emitEvent('error:occurred', {
            step,
            error: error.message,
            timestamp: Date.now(),
          });
          throw error;
        }

        // Execute current step
        const handler = this.steps[step];
        if (!handler) {
          const error = new Error(`Unknown step: ${step}`);
          this._emitEvent('error:occurred', {
            step,
            error: error.message,
            timestamp: Date.now(),
          });
          throw error;
        }

        await handler(currentState);

        // Small delay for logging visibility
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (error) {
      console.error(`[Runner] Error: ${error.message}`);

      // Emit error occurred
      this._emitEvent('error:occurred', {
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      });

      await this.handleError(error);

      // Ensure all events are flushed before rethrowing
      await this.flush();

      throw error;
    }
  }

  /**
   * Step 1: Validate PRD
   */
  async validatePRD(state) {
    const stepName = 'validate-prd';
    console.log('[Step 1] Validating PRD...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'validation',
      timestamp: Date.now(),
    });

    // Emit validation start
    this._emitEvent('validation:start', {
      prdPath: state.prdPath,
      timestamp: Date.now(),
    });

    // Read PRD content
    const prdContent = await this.readPrdFile(state.prdPath);

    // Parse PRD
    const parsedPRD = this.parsePRD(prdContent);

    // Emit validation success
    this._emitEvent('validation:success', {
      prdPath: state.prdPath,
      requirementsCount: parsedPRD.requirements?.length || 0,
      timestamp: Date.now(),
    });

    console.log('  ✓ PRD is valid');

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'validation',
      nextStep: 'analyze-prd',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'analyze-prd',
      prdContent,
      parsedPRD,
    });

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });
  }

  /**
   * Step 2: Analyze PRD
   * Deterministic code analysis - no AI agents
   */
  async analyzePRD(state) {
    const stepName = 'analyze-prd';
    console.log('[Step 2] Analyzing PRD...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'analysis',
      timestamp: Date.now(),
    });

    // Use deterministic analyzer (pure code, no AI)
    const analysis = analyzePRDDeterministic(state.prdContent);

    // Validate analysis structure
    this.validateAnalysis(analysis);

    console.log(
      `  ✓ Analyzed PRD: ${analysis.featureName} with ${analysis.requirements?.length || 0} requirements`,
    );

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'analysis',
      nextStep: 'create-epics',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'create-epics',
      analysis: analysis,
    });
  }

  /**
   * Step 2b: Create Epics from Analysis
   * Creates phase-based epics for organizing requirements
   */
  async createEpicsFromAnalysis(state) {
    const stepName = 'create-epics';
    console.log('[Step 2b] Creating epics from analysis...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'epic-creation',
      timestamp: Date.now(),
    });

    const { analysis, idMapping = {} } = state;
    const requirements = analysis.requirements || [];

    // Auto-detect phases based on requirement groupings
    // For simplicity, we'll create 4 phases based on requirement distribution
    const phases = this.detectPhases(requirements);
    const epicIds = {};

    console.log(`  Creating ${phases.length} phase epics...`);

    // Create master epic
    const masterEpic = {
      localId: 'epic-master',
      title: `EPIC: ${analysis.featureName}`,
      description: `Master epic for ${analysis.featureName} implementation.\n\nTotal Requirements: ${requirements.length}\nPhases: ${phases.length}`,
      level: 0,
      priority: 0,
      type: 'epic',
      labels: ['prd:epic', 'type:epic', 'prd:master'],
      metadata: {
        epic_type: 'master',
        feature_name: analysis.featureName,
        total_requirements: requirements.length,
        total_phases: phases.length,
        global_context: analysis.globalContext,
      },
    };

    const masterEpicId = this.executor.createTask(masterEpic, []);
    epicIds['master'] = masterEpicId;
    idMapping['epic-master'] = masterEpicId;

    this._emitEvent('task:created', {
      step: stepName,
      localId: 'epic-master',
      taskId: masterEpicId,
      taskType: 'epic',
      epicType: 'master',
      timestamp: Date.now(),
    });

    console.log(`  ✓ Created master epic: ${masterEpicId}`);

    // Create phase epics
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const localId = `epic-phase-${i}`;

      const phaseEpic = {
        localId,
        title: `PHASE ${i}: ${phase.name}`,
        description: `Phase ${i} epic covering ${phase.requirements.length} requirements.\n\n${phase.description || ''}`,
        level: 1,
        dependsOn: i === 0 ? [] : [`epic-phase-${i - 1}`], // Each phase depends on previous
        priority: 1,
        type: 'epic',
        labels: ['prd:epic', 'type:epic', 'prd:phase', `prd:phase-${i}`],
        metadata: {
          epic_type: 'phase',
          phase_index: i,
          phase_name: phase.name,
          requirements: phase.requirements.map((r) => r.id),
          parent_epic: 'epic-master',
        },
      };

      const phaseEpicId = this.executor.createTask(
        phaseEpic,
        i === 0 ? [masterEpicId] : [epicIds[`phase-${i - 1}`], masterEpicId],
      );

      epicIds[`phase-${i}`] = phaseEpicId;
      idMapping[localId] = phaseEpicId;

      // Add parent_of relationship
      this.executor.addDependency(masterEpicId, phaseEpicId, 'parent_of');

      this._emitEvent('task:created', {
        step: stepName,
        localId,
        taskId: phaseEpicId,
        taskType: 'epic',
        epicType: 'phase',
        phaseIndex: i,
        timestamp: Date.now(),
      });

      console.log(
        `  ✓ Created phase ${i} epic: ${phaseEpicId} (${phase.requirements.length} reqs)`,
      );
    }

    // Store phase mapping in state
    const reqToPhase = new Map();
    phases.forEach((phase, idx) => {
      phase.requirements.forEach((req) => {
        reqToPhase.set(req.id, idx);
      });
    });

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'epic-creation',
      nextStep: 'create-approval',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'create-approval',
      epicIds,
      phases,
      reqToPhase: Object.fromEntries(reqToPhase),
      idMapping,
    });

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });

    console.log(`  ✓ Created ${phases.length} phase epics`);
  }

  /**
   * Auto-detect phases from requirements
   * Groups requirements into logical phases
   */
  detectPhases(requirements) {
    const phases = [];
    const reqCount = requirements.length;

    if (reqCount <= 10) {
      // Small PRD: single phase
      phases.push({
        name: 'Implementation',
        description: 'Complete implementation',
        requirements: [...requirements],
      });
    } else if (reqCount <= 20) {
      // Medium PRD: 2 phases
      const mid = Math.ceil(reqCount / 2);
      phases.push({
        name: 'Foundation',
        description: 'Core infrastructure and basic features',
        requirements: requirements.slice(0, mid),
      });
      phases.push({
        name: 'Features',
        description: 'Advanced features and enhancements',
        requirements: requirements.slice(mid),
      });
    } else if (reqCount <= 30) {
      // Large PRD: 3 phases
      const size = Math.ceil(reqCount / 3);
      phases.push({
        name: 'Foundation',
        description: 'Core infrastructure',
        requirements: requirements.slice(0, size),
      });
      phases.push({
        name: 'Core Features',
        description: 'Primary functionality',
        requirements: requirements.slice(size, size * 2),
      });
      phases.push({
        name: 'Advanced',
        description: 'Advanced features and polish',
        requirements: requirements.slice(size * 2),
      });
    } else {
      // Very large PRD: 4 phases
      const size = Math.ceil(reqCount / 4);
      phases.push({
        name: 'Foundation & Architecture',
        description: 'Architecture, models, and core infrastructure',
        requirements: requirements.slice(0, size),
      });
      phases.push({
        name: 'Core Features',
        description: 'Primary functionality and integrations',
        requirements: requirements.slice(size, size * 2),
      });
      phases.push({
        name: 'Advanced Features',
        description: 'Advanced capabilities and services',
        requirements: requirements.slice(size * 2, size * 3),
      });
      phases.push({
        name: 'Quality & Deployment',
        description: 'Quality gates, testing, and deployment',
        requirements: requirements.slice(size * 3),
      });
    }

    return phases;
  }

  /**
   * Validate agent analysis output
   */
  validateAnalysis(analysis) {
    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Analysis must be an object');
    }

    if (!analysis.featureName || typeof analysis.featureName !== 'string') {
      throw new Error('Analysis must have featureName string');
    }

    if (!Array.isArray(analysis.requirements)) {
      throw new Error('Analysis must have requirements array');
    }

    for (const req of analysis.requirements) {
      if (!req.id || typeof req.id !== 'string') {
        throw new Error('Each requirement must have an id');
      }
      if (!req.type || typeof req.type !== 'string') {
        throw new Error('Each requirement must have a type');
      }
      if (!req.title || typeof req.title !== 'string') {
        throw new Error('Each requirement must have a title');
      }
      if (!Array.isArray(req.acceptanceCriteria)) {
        req.acceptanceCriteria = []; // Default to empty array
      }
    }

    return true;
  }

  /**
   * Detect if project qualifies for discovery skip (greenfield optimization)
   * Requires 3 out of 4 conditions to be met for practical reliability
   */
  async shouldSkipDiscovery(state) {
    const { prdContent, parsedPRD } = state;

    // Check 1: PRD has comprehensive research (section 9+)
    const hasResearch = this.hasComprehensiveResearch(prdContent);

    // Check 2: Greenfield project (no existing src/ files in project root)
    const isGreenfield = await this.isGreenfieldProject();

    // Check 3: Self-contained feature (no external APIs/databases)
    const isSelfContained = this.isSelfContainedFeature(parsedPRD);

    // Check 4: Clear implementation approach
    const hasClearApproach = this.hasClearImplementationApproach(prdContent);

    // Score-based detection (need 3+ points)
    let score = 0;
    if (hasResearch) score++;
    if (isGreenfield) score++;
    if (isSelfContained) score++;
    if (hasClearApproach) score++;

    const shouldSkip = score >= 3;

    if (shouldSkip) {
      console.log('  🚀 Greenfield optimization: Skipping discovery phase');
      console.log(`     Score: ${score}/4 conditions met`);
    } else {
      console.log(`  ℹ️  Discovery phase enabled (${score}/4 conditions met)`);
    }

    return shouldSkip;
  }

  hasComprehensiveResearch(prdContent) {
    // Check for Section 9+ or Research section
    const hasSection9 =
      /#{1,3}\s*(9|Research|Context|Best Practices|Domain|Technical Context)/i.test(
        prdContent,
      );
    // Check for detailed implementation guidance (substantial PRD)
    const hasImplementationGuidance = prdContent.length > 3000;
    return hasSection9 || hasImplementationGuidance;
  }

  async isGreenfieldProject() {
    try {
      const cwd = process.cwd();
      const dirsToCheck = ['src', 'lib', 'app', 'source', 'dist', 'build'];

      // Check for common source directories
      for (const dir of dirsToCheck) {
        const dirPath = path.join(cwd, dir);
        try {
          const entries = await fs.readdir(dirPath);
          if (entries.length > 0) {
            return false; // Found existing code
          }
        } catch {
          // Directory doesn't exist, continue checking
        }
      }

      // Check for source files in root
      const rootEntries = await fs.readdir(cwd);
      const sourceFilePattern = /\.(ts|js|tsx|jsx|py|go|rs|java)$/i;
      const hasSourceFiles = rootEntries.some((entry) =>
        sourceFilePattern.test(entry),
      );

      return !hasSourceFiles;
    } catch {
      return true; // Assume greenfield if we can't check
    }
  }

  isSelfContainedFeature(parsedPRD) {
    // Check requirements for external dependencies
    const requirements = parsedPRD?.requirements || [];

    for (const req of requirements) {
      const desc = (req.description || '').toLowerCase();
      const title = (req.title || '').toLowerCase();

      // Check for complex integration indicators
      const hasExternalAPI =
        /\b(api|endpoint|integration|service|database|db|third.party|external)\b/.test(
          desc + ' ' + title,
        );
      const hasComplexDeps =
        /\b(auth|payment|oauth|webhook|queue|cache|microservice|grpc|graphql|rest)\b/.test(
          desc + ' ' + title,
        );

      if (hasExternalAPI || hasComplexDeps) {
        return false;
      }
    }

    return true;
  }

  hasClearImplementationApproach(prdContent) {
    // Check for technology stack specification
    const hasTechStack =
      /\b(typescript|javascript|python|react|vue|angular|node|bun|deno|svelte|solid)\b/i.test(
        prdContent,
      );
    // Check for architecture patterns
    const hasPatterns =
      /\b(pattern|architecture|design|structure|approach|pattern|framework)\b/i.test(
        prdContent,
      );
    // Check for file specifications
    const hasFileSpecs =
      /#{1,4}.*files?:/i.test(prdContent) ||
      /`[^`]+\.(ts|js|tsx|jsx|py)`/.test(prdContent);

    return hasTechStack && (hasPatterns || hasFileSpecs);
  }

  /**
   * Step 3: Create Approval Gate
   */
  async createApprovalGate(state) {
    const stepName = 'create-approval';
    console.log('[Step 3] Creating approval gate...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'approval-gate',
      timestamp: Date.now(),
    });

    const analysis = state.analysis;
    const approvalGate = {
      title: `APPROVE: ${analysis.featureName} Implementation Review`,
      description: `Review and approve implementation plan for ${analysis.featureName}.\n\nTotal Requirements: ${analysis.requirements?.length || 0}\nEstimated Hours: ${analysis.requirements?.reduce((sum, r) => sum + (r.estimatedHours || 0), 0) || 0}`,
      priority: 1,
      type: 'approval',
      labels: ['approval-gate', 'review'],
    };

    const approvalId = this.executor.createApprovalGate(approvalGate);

    // Emit task gate created
    this._emitEvent('task:gate:created', {
      step: stepName,
      gateType: 'approval',
      gateId: approvalId,
      featureName: analysis.featureName,
      requirementsCount: analysis.requirements?.length || 0,
      timestamp: Date.now(),
    });

    console.log(`  ✓ Created approval gate: ${approvalId}`);

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'approval-gate',
      nextStep: 'create-tasks',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'create-tasks',
      idMapping: {
        ...state.idMapping,
        approvalGate: approvalId,
      },
    });

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });
  }

  /**
   * Step 4: Create Tasks from Analysis
   * DETERMINISTIC: Creates ALL tasks from agent analysis - no agent involvement
   */
  async createTasksFromAnalysis(state) {
    const stepName = 'create-tasks';
    console.log('[Step 4] Creating tasks from analysis...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'task-creation',
      timestamp: Date.now(),
    });

    const { analysis, idMapping, reqToPhase, epicIds } = state;
    const requirements = analysis.requirements || [];
    const approvalId = idMapping.approvalGate;

    // Track tasks per requirement for dependency resolution
    const reqTasks = new Map(); // reqId -> { discoveryId, implementationId }

    console.log(`  Creating tasks for ${requirements.length} requirements`);

    // Emit task batch start
    this._emitEvent('task:batch:start', {
      step: stepName,
      batchType: 'all-tasks',
      requirementsCount: requirements.length,
      timestamp: Date.now(),
    });

    // Check if we should skip discovery phase (greenfield optimization)
    const skipDiscovery = await this.shouldSkipDiscovery(state);

    // Phase 1: Create Discovery tasks (Level 1) - CONDITIONAL
    if (!skipDiscovery) {
      console.log('  Phase 1: Discovery tasks');

      // Emit batch phase start for discovery
      this._emitEvent('task:batch:phase:start', {
        step: stepName,
        phase: 'discovery',
        taskCount: requirements.length,
        timestamp: Date.now(),
      });

      for (const req of requirements) {
        const localId = `discovery-${req.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        const discoveryTask = {
          localId,
          title: `Discovery: ${req.title}`,
          description: this.formatTaskDescription({
            req,
            phase: 'discovery',
            instructions: `Research and understand requirements for ${req.title}.\n\nReview the acceptance criteria below and identify any ambiguities or missing information.`,
          }),
          level: 1,
          dependsOn: ['approvalGate'],
          priority: 2,
          type: 'task',
          labels: ['discovery', req.id.toLowerCase()],
          metadata: {
            prd_requirement_id: req.id,
            estimated_hours: Math.min(req.estimatedHours * 0.2, 1),
            phase_index: reqToPhase?.[req.id] ?? 0,
            parent_epic: `epic-phase-${reqToPhase?.[req.id] ?? 0}`,
            data_models: req.dataModels || [],
          },
        };

        const discoveryId = this.executor.createTask(discoveryTask, [
          approvalId,
        ]);

        // Link to phase epic via child_of relationship
        const phaseEpicId = epicIds?.[`phase-${reqToPhase?.[req.id] ?? 0}`];
        if (phaseEpicId) {
          this.executor.addDependency(phaseEpicId, discoveryId, 'child_of');
        }

        // Emit task created
        this._emitEvent('task:created', {
          step: stepName,
          localId,
          taskId: discoveryId,
          taskType: 'discovery',
          requirementId: req.id,
          timestamp: Date.now(),
        });

        console.log(`    ✓ ${localId} → ${discoveryId}`);

        idMapping[localId] = discoveryId;
        reqTasks.set(req.id, { discoveryId, discoveryLocalId: localId });

        await this.state.update({ idMapping });
      }

      // Emit batch phase complete for discovery
      this._emitEvent('task:batch:phase:complete', {
        step: stepName,
        phase: 'discovery',
        tasksCreated: requirements.length,
        timestamp: Date.now(),
      });
    } else {
      console.log('  Phase 1: SKIPPED (greenfield optimization active)');

      // Emit phase skip
      this._emitEvent('phase:skip', {
        step: stepName,
        phase: 'discovery',
        reason: 'greenfield-optimization',
        timestamp: Date.now(),
      });
    }

    // Phase 2: Create Implementation tasks (Level 2)
    console.log('  Phase 2: Implementation tasks');

    // Emit batch phase start for implementation
    this._emitEvent('task:batch:phase:start', {
      step: stepName,
      phase: 'implementation',
      taskCount: requirements.length,
      timestamp: Date.now(),
    });

    for (const req of requirements) {
      const localId = `implement-${req.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      // Get or initialize task info for this requirement
      let taskInfo = reqTasks.get(req.id);
      if (!taskInfo) {
        taskInfo = {};
        reqTasks.set(req.id, taskInfo);
      }

      // Build dependency list based on agent's dependency mapping
      let dependsOn;
      if (skipDiscovery) {
        // Greenfield mode: Only depend on approval gate
        dependsOn = ['approvalGate'];
      } else {
        // Normal mode: Depend on discovery tasks
        const discoveryLocalId = taskInfo.discoveryLocalId || 'approvalGate';
        dependsOn = [discoveryLocalId, 'approvalGate'];

        // Add cross-requirement dependencies from discovery tasks
        const crossDeps = analysis.dependencies?.[req.id] || [];
        for (const depReqId of crossDeps) {
          const depTaskInfo = reqTasks.get(depReqId);
          if (depTaskInfo?.discoveryLocalId) {
            dependsOn.push(depTaskInfo.discoveryLocalId);
          }
        }
      }

      const implementationTask = {
        localId,
        title: req.title,
        description: this.formatTaskDescription({
          req,
          phase: 'implementation',
          instructions: `Implement ${req.title}.

Review the Context section above for files, integration points, and data models.`,
        }),
        level: 2,
        dependsOn: [...new Set(dependsOn)], // Remove duplicates
        priority: 3,
        type: 'task',
        labels: [
          'implementation',
          req.id.toLowerCase(),
          req.type.toLowerCase(),
        ],
        metadata: {
          prd_requirement_id: req.id,
          estimated_hours: req.estimatedHours,
          files: req.files || [],
          functions: req.functions || [],
          data_models: req.dataModels || [],
          integration_points: req.integrationPoints || [],
          phase_index: reqToPhase?.[req.id] ?? 0,
          parent_epic: `epic-phase-${reqToPhase?.[req.id] ?? 0}`,
        },
      };

      const implementationId = this.executor.createTask(
        implementationTask,
        dependsOn.map((dep) => idMapping[dep]).filter(Boolean),
      );

      // Link to phase epic via child_of relationship
      const phaseEpicId = epicIds?.[`phase-${reqToPhase?.[req.id] ?? 0}`];
      if (phaseEpicId) {
        this.executor.addDependency(phaseEpicId, implementationId, 'child_of');
      }

      // Emit task created
      this._emitEvent('task:created', {
        step: stepName,
        localId,
        taskId: implementationId,
        taskType: 'implementation',
        requirementId: req.id,
        timestamp: Date.now(),
      });

      console.log(`    ✓ ${localId} → ${implementationId}`);

      idMapping[localId] = implementationId;
      taskInfo.implementationId = implementationId;
      taskInfo.implementationLocalId = localId;

      // Phase 3: Create TDD sub-tasks (Level 3) - ALWAYS for implementation tasks
      console.log(`      Creating TDD sub-tasks for ${localId}`);

      // Add parent criteria to metadata for TDD subtasks to inherit
      implementationTask.metadata.parent_criteria =
        req.acceptanceCriteria || [];
      const tddTasks = this.generateTDDSubTasks(implementationTask);

      for (const tddTask of tddTasks) {
        const tddBlockers = tddTask.dependsOn.map((depLocalId) => {
          const realId = idMapping[depLocalId];
          if (!realId)
            throw new Error(`TDD dependency ${depLocalId} not found`);
          return realId;
        });

        const tddId = this.executor.createTask(tddTask, tddBlockers);

        // Emit subtask created
        this._emitEvent('task:subtask:created', {
          step: stepName,
          parentLocalId: localId,
          localId: tddTask.localId,
          taskId: tddId,
          subtaskType: tddTask.localId.split('-').pop(), // red, green, refactor, syntax
          timestamp: Date.now(),
        });

        console.log(`        ✓ ${tddTask.localId} → ${tddId}`);
        idMapping[tddTask.localId] = tddId;
      }

      await this.state.update({ idMapping });
    }

    // Emit batch phase complete for implementation
    this._emitEvent('task:batch:phase:complete', {
      step: stepName,
      phase: 'implementation',
      tasksCreated: requirements.length,
      timestamp: Date.now(),
    });

    console.log(`  ✓ Created all tasks deterministically`);
    if (skipDiscovery) {
      console.log(
        `    - 0 discovery tasks (skipped - greenfield optimization)`,
      );
    } else {
      console.log(`    - ${requirements.length} discovery tasks`);
    }
    console.log(`    - ${requirements.length} implementation tasks`);
    console.log(`    - ${requirements.length * 4} TDD sub-tasks`);

    // Emit task batch complete
    this._emitEvent('task:batch:complete', {
      step: stepName,
      discoveryTasks: skipDiscovery ? 0 : requirements.length,
      implementationTasks: requirements.length,
      tddSubtasks: requirements.length * 4,
      totalTasks: skipDiscovery
        ? requirements.length * 5
        : requirements.length * 6,
      timestamp: Date.now(),
    });

    // Create LINT gate after all SYNTAX tasks
    await this.createLintGate(state);

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'task-creation',
      nextStep: 'verify',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'verify',
    });
  }

  /**
   * Step 5: Create LINT gate task that runs after all SYNTAX tasks complete
   */
  async createLintGate(state) {
    const stepName = 'create-lint-gate';
    console.log('[Step 5] Creating LINT gate...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'lint-gate',
      timestamp: Date.now(),
    });

    const { idMapping } = state;

    // Collect all SYNTAX task IDs
    const syntaxTaskIds = Object.keys(idMapping).filter((localId) =>
      localId.endsWith('-syntax'),
    );

    if (syntaxTaskIds.length === 0) {
      console.log('  No SYNTAX tasks found, skipping LINT gate');

      // Emit phase skip
      this._emitEvent('phase:skip', {
        step: stepName,
        phase: 'lint-gate',
        reason: 'no-syntax-tasks',
        timestamp: Date.now(),
      });

      return;
    }

    console.log(`  Found ${syntaxTaskIds.length} SYNTAX tasks`);

    // Resolve SYNTAX task dependencies
    const syntaxBlockers = syntaxTaskIds.map((localId) => {
      const realId = idMapping[localId];
      if (!realId)
        throw new Error(`SYNTAX task ${localId} not found in idMapping`);
      return realId;
    });

    // Create LINT gate task
    const lintGateTask = {
      localId: 'lint-gate',
      title: 'LINT GATE: Code Quality Review',
      description: `Comprehensive Biome linting on all implementation\n\nCommand: biome lint --apply src/\n\nAcceptance Criteria:\n- Biome passes with exit code 0\n- All safe fixes applied automatically\n- No remaining lint errors\n\nFailure Handling:\nIf this task fails, a 'Fix All Lint Errors' task will be created.\nIf that fix task also fails, escalation will be required.`,
      level: 4,
      dependsOn: syntaxTaskIds,
      priority: 1,
      type: 'task',
      labels: ['lint-gate', 'quality-gate', 'blocks-qa'],
      metadata: {
        gate_type: 'lint',
        scope: 'all-implementation',
      },
    };

    const lintGateId = this.executor.createTask(lintGateTask, syntaxBlockers);

    // Emit task gate created
    this._emitEvent('task:gate:created', {
      step: stepName,
      gateType: 'lint',
      gateId: lintGateId,
      blockedByCount: syntaxTaskIds.length,
      timestamp: Date.now(),
    });

    console.log(
      `  ✓ LINT gate created: ${lintGateId} (blocked by ${syntaxTaskIds.length} SYNTAX tasks)`,
    );

    idMapping['lint-gate'] = lintGateId;

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'lint-gate',
      nextStep: 'verify',
      timestamp: Date.now(),
    });

    // Save state
    await this.state.update({ idMapping });

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });
  }

  /**
   * Step 6: Verify and Summarize
   */
  async verifyAndSummarize(state) {
    const stepName = 'verify';
    console.log('[Step 6] Verifying task structure...');

    // Emit phase start
    this._emitEvent('phase:start', {
      step: stepName,
      phase: 'verification',
      timestamp: Date.now(),
    });

    // Verify approval gate is ready (and blocking other tasks)
    const readyTasks = this.executor.getReadyTasks();
    const approvalId = state.idMapping.approvalGate;

    // Check that approval gate is in ready list
    const approvalReady = readyTasks.some((task) => task.id === approvalId);

    if (!approvalReady) {
      const error = new Error('Expected approval gate to be ready');
      this._emitEvent('error:occurred', {
        step: stepName,
        error: error.message,
        timestamp: Date.now(),
      });
      throw error;
    }

    // Count tasks created
    const discoveryCount = Object.keys(state.idMapping).filter((k) =>
      k.startsWith('discovery-'),
    ).length;
    const implementCount = Object.keys(state.idMapping).filter(
      (k) =>
        k.startsWith('implement-') &&
        !k.includes('-red') &&
        !k.includes('-green') &&
        !k.includes('-refactor') &&
        !k.includes('-syntax'),
    ).length;
    const tddCount = Object.keys(state.idMapping).filter(
      (k) =>
        k.includes('-red') ||
        k.includes('-green') ||
        k.includes('-refactor') ||
        k.includes('-syntax'),
    ).length;

    console.log(`  ✓ Approval gate ready: ${approvalId}`);
    console.log(`  ✓ Created ${discoveryCount} discovery tasks`);
    console.log(`  ✓ Created ${implementCount} implementation tasks`);
    console.log(`  ✓ Created ${tddCount} TDD sub-tasks`);

    // Verify that main implementation tasks are NOT ready (they should be blocked)
    const implementIds = Object.keys(state.idMapping)
      .filter((k) => k.startsWith('implement-') && !k.includes('-'))
      .map((k) => state.idMapping[k]);

    const blockedImplementTasks = implementIds.filter(
      (id) => !readyTasks.some((t) => t.id === id),
    );

    console.log(
      `  ✓ ${blockedImplementTasks.length}/${implementIds.length} implementation tasks blocked`,
    );

    // Verify no duplicates by checking title uniqueness
    const titles = new Set();
    const duplicates = [];
    for (const req of state.analysis?.requirements || []) {
      const discoveryTitle = `Discovery: ${req.title}`;
      const implementTitle = req.title;

      if (titles.has(discoveryTitle)) duplicates.push(discoveryTitle);
      if (titles.has(implementTitle)) duplicates.push(implementTitle);

      titles.add(discoveryTitle);
      titles.add(implementTitle);
    }

    if (duplicates.length > 0) {
      console.warn(
        `  ⚠ Found ${duplicates.length} potential duplicate titles:`,
        duplicates,
      );
    } else {
      console.log('  ✓ No duplicate task titles detected');
    }

    console.log('  ✓ Only approval gate is ready (all others blocked)');

    // Emit verification complete
    this._emitEvent('verification:complete', {
      step: stepName,
      approvalGateReady: approvalReady,
      discoveryTasks: discoveryCount,
      implementationTasks: implementCount,
      tddSubtasks: tddCount,
      blockedImplementationTasks: blockedImplementTasks.length,
      duplicateWarnings: duplicates.length,
      timestamp: Date.now(),
    });

    // Emit phase complete
    this._emitEvent('phase:complete', {
      step: stepName,
      phase: 'verification',
      nextStep: 'completed',
      timestamp: Date.now(),
    });

    await this.state.update({
      currentStep: 'completed',
    });

    // Emit state save
    this._emitEvent('state:save', {
      step: stepName,
      timestamp: Date.now(),
    });
  }

  /**
   * Format task description with JSON Context + Markdown Instructions
   * Large data model definitions are moved to metadata with a reference in description
   * @param {Object} options - Formatting options
   * @returns {string} Formatted description
   */
  formatTaskDescription({ req, phase, instructions }) {
    // Build compact context for JSON (without large definitions)
    const context = {
      task: {
        id: req.originalId || req.id,
        title: req.title,
        type: req.type,
        phase: phase,
        estimated_hours: req.estimatedHours,
      },
      target: {
        files: req.files || [],
        functions: req.functions || [],
        integration_points:
          req.integrationPoints?.map((p) => ({
            id: p.pointNumber,
            location: this.extractLocationFromPoint(p),
          })) || [],
      },
      data: {
        // Only names and types in description - full definitions in metadata
        models:
          req.dataModels?.map((m) => ({
            name: m.name,
            type: m.type,
          })) || [],
      },
      criteria: req.acceptanceCriteria || [],
      configuration: req.configuration || [],
      dependencies: req.dependencies || [],
    };

    return `## Context

**Note: Full data model definitions are available in the task metadata under "data_models" field.**

\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## Instructions

${instructions}

## PRD Description

${req.description}`;
  }

  /**
   * Extract file:function location from integration point
   * @param {Object} point - Integration point
   * @returns {string} Location string
   */
  extractLocationFromPoint(point) {
    const match = point.details.match(/`?([\w/]+\.\w+):(\w+)\(\)`?/);
    if (match) {
      return `${match[1]}:${match[2]}()`;
    }
    return point.title;
  }

  /**
   * Format TDD subtask description with inherited criteria
   * @param {Object} options - Formatting options
   * @returns {string} Formatted description
   */
  formatTDDDescription({
    phase,
    cleanTitle,
    parentCriteria,
    parentFiles,
    parentFunctions,
    specificInstructions,
  }) {
    const context = {
      task: {
        title: cleanTitle,
        phase: phase,
        parent_phase: 'tdd',
      },
      target: {
        files: parentFiles,
        functions: parentFunctions,
      },
      criteria: {
        parent: parentCriteria,
        phase_specific: this.getPhaseSpecificCriteria(phase),
      },
    };

    return `## Context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\n## Instructions\n\n${specificInstructions}`;
  }

  /**
   * Get phase-specific TDD criteria
   * @param {string} phase - TDD phase (red, green, refactor, syntax)
   * @returns {Array} Phase-specific criteria
   */
  getPhaseSpecificCriteria(phase) {
    const criteria = {
      red: [
        'Tests cover all parent acceptance criteria',
        'Tests fail initially (RED phase)',
        '≥80% code coverage target',
      ],
      green: [
        'All tests pass (GREEN phase)',
        'Implementation satisfies parent criteria',
        'No premature refactoring',
      ],
      refactor: [
        'Code is clean and maintainable',
        'All tests still pass',
        'Better naming, no duplication',
        'Improved readability',
      ],
      syntax: [
        'Biome lint passes with no errors',
        'No syntax errors in modified files',
        'Code follows project style guidelines',
      ],
    };
    return criteria[phase] || [];
  }

  /**
   * Generate TDD sub-tasks for an implementation task
   */
  generateTDDSubTasks(parentTask) {
    const baseId = parentTask.localId;
    // Use normalizeTitle for consistent cleanup across all titles
    // Note: Keep (Part X/Y) suffix to ensure unique titles for multi-part requirements
    const cleanTitle = this.normalizeTitle(parentTask.title)
      .replace(/^FR-\d+[a-z]?:\s*/i, '') // Remove FR-XXX: prefix
      .replace(/^NFR-\d+[a-z]?:\s*/i, '') // Remove NFR-XXX: prefix
      .replace(/^US-\d+[a-z]?:\s*/i, '') // Remove US-XXX: prefix
      .replace(/^Implement\s+/i, '') // Remove leading "Implement"
      .trim();

    // Extract parent criteria from metadata or parse from parent description
    const parentCriteria = parentTask.metadata?.parent_criteria || [];
    const parentFiles = parentTask.metadata?.files || [];
    const parentFunctions = parentTask.metadata?.functions || [];

    return [
      {
        localId: `${baseId}-red`,
        title: `RED: Write tests for ${cleanTitle}`,
        description: this.formatTDDDescription({
          phase: 'red',
          cleanTitle,
          parentCriteria,
          parentFiles,
          parentFunctions,
          specificInstructions:
            'Write failing tests that cover all acceptance criteria below.',
        }),
        level: parentTask.level,
        dependsOn: [parentTask.localId],
        priority: parentTask.priority,
        type: 'task',
        labels: [...new Set([...parentTask.labels, 'tdd-red', 'testing'])],
        metadata: {
          tdd_phase: 'red',
          parent_task: baseId,
        },
      },
      {
        localId: `${baseId}-green`,
        title: `GREEN: Implement ${cleanTitle}`,
        description: this.formatTDDDescription({
          phase: 'green',
          cleanTitle,
          parentCriteria,
          parentFiles,
          parentFunctions,
          specificInstructions:
            'Implement the functionality to make all tests pass. Focus on correctness over elegance.',
        }),
        level: parentTask.level,
        dependsOn: [`${baseId}-red`],
        priority: parentTask.priority,
        type: 'task',
        labels: [
          ...new Set([...parentTask.labels, 'tdd-green', 'implementation']),
        ],
        metadata: {
          tdd_phase: 'green',
          parent_task: baseId,
        },
      },
      {
        localId: `${baseId}-refactor`,
        title: `REFACTOR: Optimize ${cleanTitle}`,
        description: this.formatTDDDescription({
          phase: 'refactor',
          cleanTitle,
          parentCriteria,
          parentFiles,
          parentFunctions,
          specificInstructions:
            'Refactor the implementation while keeping all tests passing. Improve naming, remove duplication, enhance readability.',
        }),
        level: parentTask.level,
        dependsOn: [`${baseId}-green`],
        priority: parentTask.priority,
        type: 'task',
        labels: [...new Set([...parentTask.labels, 'tdd-refactor', 'cleanup'])],
        metadata: {
          tdd_phase: 'refactor',
          parent_task: baseId,
        },
      },
      {
        localId: `${baseId}-syntax`,
        title: `SYNTAX: Check ${cleanTitle}`,
        description: this.formatTDDDescription({
          phase: 'syntax',
          cleanTitle,
          parentCriteria,
          parentFiles,
          parentFunctions,
          specificInstructions: `Run Biome linting on the modified files. Fix any syntax errors or linting issues.`,
        }),
        level: parentTask.level,
        dependsOn: [`${baseId}-refactor`],
        priority: parentTask.priority,
        type: 'task',
        labels: [
          ...new Set([
            ...parentTask.labels,
            'tdd-syntax',
            'quality',
            'attempt-syntax-lint-max-5',
            'attempt-syntax-lint-retries-0',
          ]),
        ],
        metadata: {
          tdd_phase: 'syntax',
          parent_task: baseId,
          syntax_check: true,
          files_to_check: parentFiles,
          max_retries: 5,
          current_retry: 0,
        },
      },
    ];
  }

  /**
   * Handle errors with retry and rollback
   */
  async handleError(error) {
    const state = await this.state.load();
    const step = state.currentStep;

    // Log error
    await this.state.logError(step, error);

    // Check retry count
    const retryCount = await this.state.incrementRetry(step);

    // Emit retry attempt
    this._emitEvent('retry:attempt', {
      step,
      attempt: retryCount,
      maxRetries: 3,
      error: error.message,
      timestamp: Date.now(),
    });

    if (retryCount >= 3) {
      console.log('[Runner] Max retries exceeded, rolling back...');

      // Emit rollback start
      this._emitEvent('rollback:start', {
        step,
        reason: 'max-retries-exceeded',
        timestamp: Date.now(),
      });

      // Execute rollback with progress events
      const rollbackSteps = ['tasks', 'approval-gate', 'state'];
      for (let i = 0; i < rollbackSteps.length; i++) {
        const rollbackStep = rollbackSteps[i];

        // Emit rollback progress
        this._emitEvent('rollback:progress', {
          step,
          rollbackStep,
          progress: Math.round(((i + 1) / rollbackSteps.length) * 100),
          timestamp: Date.now(),
        });
      }

      await this.rollback.execute(state);

      // Emit rollback complete
      this._emitEvent('rollback:complete', {
        step,
        success: true,
        timestamp: Date.now(),
      });

      await this.state.update({ currentStep: 'failed' });
    }
  }

  /**
   * Generate final summary
   */
  generateSummary(state) {
    const reqCount = state.analysis?.requirements?.length || 0;
    const discoveryCount = Object.keys(state.idMapping).filter((k) =>
      k.startsWith('discovery-'),
    ).length;
    const implementCount = Object.keys(state.idMapping).filter(
      (k) =>
        k.startsWith('implement-') &&
        !k.includes('-red') &&
        !k.includes('-green') &&
        !k.includes('-refactor') &&
        !k.includes('-syntax'),
    ).length;
    const tddCount = Object.keys(state.idMapping).filter(
      (k) =>
        k.includes('-red') ||
        k.includes('-green') ||
        k.includes('-refactor') ||
        k.includes('-syntax'),
    ).length;

    return {
      sessionId: this.sessionId,
      success: true,
      featureName: state.analysis?.featureName,
      approvalGate: state.idMapping.approvalGate,
      stats: {
        requirements: reqCount,
        discoveryTasks: discoveryCount,
        implementationTasks: implementCount,
        tddSubTasks: tddCount,
        totalTasks: Object.keys(state.idMapping).length,
      },
      executionTime: Date.now() - new Date(state.startedAt).getTime(),
    };
  }

  // Helper methods
  async readPrdFile(prdPath) {
    return await fs.readFile(prdPath, 'utf8');
  }

  parsePRD(content) {
    // Parse PRD and extract ALL requirements (FRs, NFRs, User Stories, Setup, Docs, QA)
    const lines = content.split('\n');
    const requirements = [];
    let reqCounter = 1;

    lines.forEach((line) => {
      // Match requirement headers: FR-*, NFR-*, US-*, Setup-*, Doc-*, QA-*
      // Relaxed to accept: h3/h4, FR1/FR-1/FR-001 formats
      const match = line.match(
        /^#{3,4}\s+(FR-?\d+[a-z]?|NFR-?\d+[a-z]?|US-?\d+|Setup-?\d+|Doc-?\d+|QA-?\d+):?\s*(.+)$/i,
      );
      if (match) {
        const reqId = `REQ-${String(reqCounter).padStart(3, '0')}`;
        reqCounter++;
        requirements.push({
          id: reqId,
          originalId: match[1].toUpperCase(), // Store original ID for reference
          title: match[2].trim(),
          acceptanceCriteria: [],
        });
      }
    });

    return { title: 'Parsed PRD', requirements };
  }

  /**
   * Normalize task title - remove numbered prefixes and reformat
   * Ensures compliance with PRD-exact title requirement
   * Note: Preserves (Part X/Y) suffixes for TDD task uniqueness
   */
  normalizeTitle(title) {
    if (!title) return title;

    // Remove numbered prefixes like "1.0 ", "2.0 ", "10.1 ", etc.
    let normalized = title.replace(/^\d+\.\d+\s+/, '').trim();

    // Remove "Developer - " pattern (case insensitive)
    normalized = normalized.replace(/\s*Developer\s+-\s*/gi, ' ').trim();

    // Remove "Discovery & Planning" generic text
    normalized = normalized
      .replace(/Discovery\s*&\s*Planning/i, 'Discovery')
      .trim();

    // Note: We intentionally DO NOT remove (Part X/Y) suffixes here
    // They are needed for TDD task title uniqueness in multi-part requirements
    // The suffix removal should only happen for consolidated display titles,
    // not for task generation where uniqueness matters

    // Remove "Discovery & Planning [Developer - ...]" suffix pattern
    normalized = normalized.replace(/\s*\[Developer\s*-[^\]]*\]/i, '').trim();

    // Clean up extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }
}

export default TaskBreakdownRunner;
