/**
 * Deterministic PRD Analyzer
 *
 * Pure code-based PRD analysis without AI agents.
 * Parses PRD markdown and extracts structured requirements.
 */

/**
 * Analyze PRD content deterministically using regex and parsing
 * @param {string} prdContent - Raw PRD markdown content
 * @returns {Object} Structured analysis
 */
export function analyzePRDDeterministic(prdContent) {
  const lines = prdContent.split('\n');
  const requirements = [];
  let featureName = 'Untitled Feature';
  let reqCounter = 1;
  let currentReq = null;
  let inAcceptanceCriteria = false;
  let inDescription = true;

  // Extract feature name from title (first H1)
  const titleMatch = prdContent.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    featureName = titleMatch[1].trim();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Match requirement headers: ### FR-*, ### NFR-*, ### US-*, etc.
    // Relaxed to accept: h3/h4, FR1/FR-1/FR-001 formats
    const reqMatch = trimmedLine.match(
      /^#{3,4}\s+(FR-?\d+[a-z]?|NFR-?\d+[a-z]?|US-?\d+|Setup-?\d+|Doc-?\d+|QA-?\d+):?\s*(.+)$/i,
    );

    if (reqMatch) {
      // Check for non-standard format and log warning
      const originalId = reqMatch[1];
      const headerLevel = trimmedLine.match(/^(#{3,4})/)?.[1];

      // Warn about non-standard formats
      if (
        headerLevel === '####' ||
        !originalId.match(/^(FR|NFR|US|Setup|Doc|QA)-\d{3}/)
      ) {
        console.log(
          `⚠️  PRD uses non-standard requirement format: "${originalId}"`,
        );
        console.log(
          `   Consider regenerating PRD with updated create-prd skill for consistent formatting`,
        );
      }

      // Save previous requirement if exists
      if (currentReq) {
        requirements.push(currentReq);
      }

      const reqId = `REQ-${String(reqCounter).padStart(3, '0')}`;
      reqCounter++;

      // Determine type from prefix
      let type = 'FR';
      if (reqMatch[1].toUpperCase().startsWith('NFR')) type = 'NFR';
      else if (reqMatch[1].toUpperCase().startsWith('US')) type = 'User Story';
      else if (reqMatch[1].toUpperCase().startsWith('SETUP')) type = 'Setup';
      else if (reqMatch[1].toUpperCase().startsWith('DOC')) type = 'Docs';
      else if (reqMatch[1].toUpperCase().startsWith('QA')) type = 'QA';

      currentReq = {
        id: reqId,
        originalId: reqMatch[1].toUpperCase(),
        title: reqMatch[2].trim(),
        description: '',
        acceptanceCriteria: [],
        estimatedHours: estimateHoursFromDescription(''),
        type: type,
        files: [],
        functions: [],
        dataModels: [],
        integrationPoints: [],
        configuration: [],
      };

      inAcceptanceCriteria = false;
      inDescription = true;
      continue;
    }

    // If we have a current requirement, accumulate description
    if (currentReq) {
      // Check for acceptance criteria section (handles **bold** markdown)
      if (trimmedLine.match(/^\*{0,2}(####?\s+)?acceptance criteria\*{0,2}/i)) {
        inAcceptanceCriteria = true;
        inDescription = false;
        continue;
      }

      // Check for end of acceptance criteria (new header or empty line after AC)
      if (inAcceptanceCriteria) {
        if (trimmedLine.match(/^#{1,4}\s/)) {
          inAcceptanceCriteria = false;
          inDescription = true;
        } else if (trimmedLine.match(/^-\s+(.+)$/)) {
          // Add to acceptance criteria
          let acText = trimmedLine.replace(/^-\s+/, '').trim();

          // Strip ID prefixes like "FR1.1:", "AC1:", "NFR1.1:", etc.
          const originalACText = acText;
          acText = acText.replace(
            /^(?:FR|NFR|US|Setup|Doc|QA|AC)\d+(?:\.\d+)?[a-z]?:\s*/i,
            '',
          );

          // Log warning if prefix was stripped
          if (acText !== originalACText) {
            console.log(
              `⚠️  PRD uses non-standard AC format: "${originalACText}" → "${acText}"`,
            );
            console.log(
              `   Consider regenerating PRD with updated create-prd skill for consistent formatting`,
            );
          }

          currentReq.acceptanceCriteria.push(acText);
          continue;
        } else if (
          trimmedLine === '' &&
          currentReq.acceptanceCriteria.length > 0
        ) {
          // Empty line after ACs - likely end of section
          inAcceptanceCriteria = false;
          inDescription = true;
        }
      }

      // Accumulate description (not in AC section)
      if (inDescription && trimmedLine) {
        if (currentReq.description) {
          currentReq.description += '\n';
        }
        currentReq.description += trimmedLine;
      }
    }
  }

  // Don't forget the last requirement
  if (currentReq) {
    requirements.push(currentReq);
  }

  // Post-process: extract additional data and estimate hours
  // First extract global context
  const globalContext = {
    integrationPoints: extractIntegrationPoints(prdContent),
    dataModels: extractDataModels(prdContent),
    configuration: extractConfiguration(prdContent),
    architecture: extractArchitectureSection(prdContent),
  };

  // Then enrich each requirement with context
  for (const req of requirements) {
    req.estimatedHours = estimateHoursFromDescription(req.description);

    // Use enhanced extraction with explicit mappings
    extractRequirementContextEnhanced(req, prdContent, globalContext);
  }

  // Detect dependencies based on requirement references
  const dependencies = detectDependencies(requirements);

  // Validate requirements have actionable targets
  validateRequirements(requirements);

  return {
    featureName,
    requirements,
    dependencies,
    hasNFRs: requirements.some((r) => r.type === 'NFR'),
    hasUserStories: requirements.some((r) => r.type === 'User Story'),
    globalContext,
  };
}

/**
 * Extract integration points from Section 5.2 of PRD (enhanced with explicit requirement mapping)
 * @param {string} prdContent - Full PRD content
 * @returns {Array} Integration points with requirements field
 */
function extractIntegrationPoints(prdContent) {
  const points = [];

  // Look for Section 5.2 or "Integration Points" section
  const sectionPattern = /#{1,3}\s*5\.2|#{1,3}\s*Integration Points/i;
  const sectionMatch = prdContent.match(sectionPattern);

  if (sectionMatch) {
    const startIdx = sectionMatch.index;
    const headerEndMatch = prdContent.slice(startIdx).match(/\n/);
    const contentStartIdx = headerEndMatch
      ? startIdx + headerEndMatch.index + 1
      : startIdx;
    const sectionEndMatch = prdContent
      .slice(contentStartIdx)
      .match(/^#{1,3}\s[^#]/m);
    const sectionEnd = sectionEndMatch
      ? contentStartIdx + sectionEndMatch.index
      : prdContent.length;
    const sectionContent = prdContent.slice(contentStartIdx, sectionEnd);

    // Pattern: **Point N: Title** (`file.go:function()`)
    // Capture: point number, title, location (file:func), and details
    const pointPattern =
      /\*\*Point\s+(\d+):\s*([^*]+?)\*\*\s*\(`([^`]+)`\)\s*\n([\s\S]*?)(?=\*\*Point|\n#{1,3}|\n\n\*\*|$)/g;

    let pointMatch;
    while (true) {
      pointMatch = pointPattern.exec(sectionContent);
      if (pointMatch === null) break;

      const pointNumber = parseInt(pointMatch[1]);
      const title = pointMatch[2].trim();
      const location = pointMatch[3].trim();
      const details = pointMatch[4].trim();

      // Extract file:function from location
      const locMatch = location.match(/([\w/]+\.\w+):(\w+)\(\)/);
      const file = locMatch ? locMatch[1] : '';
      const func = locMatch ? locMatch[2] : '';

      // Look for explicit "Requirements:" field in details
      const reqMatch = details.match(
        /\*\*?Requirements?:\*\*?\s*([A-Z0-9a-z\-,.\s]+)/i,
      );
      const requirements = reqMatch
        ? reqMatch[1]
            .split(/[,\s]+/)
            .map((r) => r.trim())
            .filter((r) => /^[A-Z]+-\d+[a-z]?$/i.test(r))
        : [];

      points.push({
        pointNumber,
        title,
        location,
        file,
        function: func,
        details,
        requirements,
      });
    }
  }

  return points;
}

/**
 * Extract data models from PRD with requirement annotations (Go structs, TypeScript interfaces, etc.)
 * @param {string} prdContent - Full PRD content
 * @returns {Array} Data models with requirements field
 */
function extractDataModels(prdContent) {
  const models = [];

  // Look for Section 5.6 or "Data Models" section
  const sectionPattern = /#{1,3}\s*5\.6|#{1,3}\s*Data Models/i;
  const sectionMatch = prdContent.match(sectionPattern);

  if (sectionMatch) {
    const startIdx = sectionMatch.index;
    const headerEndMatch = prdContent.slice(startIdx).match(/\n/);
    const contentStartIdx = headerEndMatch
      ? startIdx + headerEndMatch.index + 1
      : startIdx;
    const sectionEndMatch = prdContent
      .slice(contentStartIdx)
      .match(/^#{1,3}\s[^#]/m);
    const sectionEnd = sectionEndMatch
      ? contentStartIdx + sectionEndMatch.index
      : prdContent.length;
    const sectionContent = prdContent.slice(contentStartIdx, sectionEnd);

    // Pattern: **ModelName** (Requirements: FR-XXX, FR-YYY)
    // followed by ```go ... ```
    const modelPattern =
      /\*\*([^*(]+)\*\*\s*\([^)]*Requirements?:\s*([A-Z0-9a-z\-,.\s]+)\)\s*\n?```(\w+)\n([\s\S]*?)```/g;

    let modelMatch;
    while (true) {
      modelMatch = modelPattern.exec(sectionContent);
      if (modelMatch === null) break;

      const name = modelMatch[1].trim();
      const reqString = modelMatch[2] || '';
      const type = modelMatch[3];
      const definition = modelMatch[4].trim();

      // Parse requirements - handle FR-004a format
      const requirements = reqString
        .split(/[,\s]+/)
        .map((r) => r.trim())
        .filter((r) => /^[A-Z]+-\d+[a-z]?$/i.test(r));

      models.push({
        name,
        type: type === 'go' ? 'go-struct' : `${type}-type`,
        definition,
        requirements,
      });
    }
  }

  // Fallback: Extract any Go struct definitions outside of Section 5.6
  const structPattern = /type\s+(\w+)\s+struct\s*\{([^}]+)\}/gs;
  let structMatch;
  while (true) {
    structMatch = structPattern.exec(prdContent);
    if (structMatch === null) break;

    const name = structMatch[1];
    // Check if already captured
    if (!models.find((m) => m.name === name)) {
      models.push({
        name,
        type: 'go-struct',
        definition: `type ${name} struct {${structMatch[2]}}`,
        requirements: [], // No explicit mapping
      });
    }
  }

  return models;
}

/**
 * Extract architecture section from PRD
 * @param {string} prdContent - Full PRD content
 * @returns {string} Architecture description
 */
function extractArchitectureSection(prdContent) {
  const sectionPattern = /#{1,3}\s*5\.1|#{1,3}\s*Architecture/i;
  const match = prdContent.match(sectionPattern);

  if (match) {
    const startIdx = match.index;
    const sectionEndMatch = prdContent.slice(startIdx).match(/^#{1,3}\s[^#]/m);
    const sectionEnd = sectionEndMatch
      ? startIdx + sectionEndMatch.index
      : prdContent.length;
    return prdContent.slice(startIdx, sectionEnd).trim();
  }

  return '';
}

/**
 * Estimate hours based on description complexity
 */
function estimateHoursFromDescription(description) {
  if (!description) return 2;

  const desc = description.toLowerCase();
  let hours = 2; // Base estimate

  // Complexity indicators
  if (desc.includes('complex') || desc.includes('advanced')) hours += 2;
  if (desc.includes('simple') || desc.includes('basic')) hours -= 1;
  if (desc.includes('database') || desc.includes('db')) hours += 1;
  if (desc.includes('api') || desc.includes('endpoint')) hours += 1;
  if (desc.includes('ui') || desc.includes('interface')) hours += 0.5;
  if (desc.includes('test') || desc.includes('validation')) hours += 0.5;

  // Length-based adjustment
  const lines = description.split('\n').length;
  if (lines > 10) hours += 1;
  if (lines > 20) hours += 1;

  return Math.max(0.5, Math.min(hours, 8)); // Clamp between 0.5 and 8 hours
}

/**
 * Detect dependencies between requirements
 */
function detectDependencies(requirements) {
  const dependencies = {};

  for (const req of requirements) {
    const deps = [];
    const text = (req.description || '').toLowerCase();

    // Look for references to other requirements
    for (const otherReq of requirements) {
      if (otherReq.id === req.id) continue;

      const patterns = [
        new RegExp(`\\b${otherReq.id}\\b`, 'i'),
        new RegExp(`\\b${otherReq.title.toLowerCase().substring(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(text)) {
          deps.push(otherReq.id);
          break;
        }
      }
    }

    if (deps.length > 0) {
      dependencies[req.id] = deps;
    }
  }

  return dependencies;
}

/**
 * Extract configuration from Section 5.4 with requirement mappings
 * @param {string} prdContent - Full PRD content
 * @returns {Array} Configuration items with requirements
 */
function extractConfiguration(prdContent) {
  const configs = [];

  // Look for Section 5.4 or "Configuration" section
  const sectionPattern = /#{1,3}\s*5\.4|#{1,3}\s*Configuration/i;
  const sectionMatch = prdContent.match(sectionPattern);

  if (sectionMatch) {
    const startIdx = sectionMatch.index;
    const headerEndMatch = prdContent.slice(startIdx).match(/\n/);
    const contentStartIdx = headerEndMatch
      ? startIdx + headerEndMatch.index + 1
      : startIdx;
    const sectionEndMatch = prdContent
      .slice(contentStartIdx)
      .match(/^#{1,3}\s[^#]/m);
    const sectionEnd = sectionEndMatch
      ? contentStartIdx + sectionEndMatch.index
      : prdContent.length;
    const sectionContent = prdContent.slice(contentStartIdx, sectionEnd);

    // Pattern: | `key` | type | default | Requirements: FR-XXX, FR-YYY |
    const configPattern =
      /\|\s*`?([^`|]+)`?\s*\|\s*(\w+)\s*\|\s*([^|]+)\|\s*([A-Z0-9-,\s]+)\s*\|/g;

    let configMatch;
    while (true) {
      configMatch = configPattern.exec(sectionContent);
      if (configMatch === null) break;

      const key = configMatch[1].trim();
      const type = configMatch[2].trim();
      const default_ = configMatch[3].trim();
      const reqString = configMatch[4].trim();

      // Parse requirements (comma or space separated IDs)
      const requirements = reqString
        .split(/[,\s]+/)
        .map((r) => r.trim())
        .filter((r) => /^[A-Z]+-\d+$/i.test(r));

      if (key && requirements.length > 0) {
        configs.push({
          key,
          type,
          default: default_,
          requirements,
        });
      }
    }
  }

  return configs;
}

/**
 * Extract implementation mappings from optional Section 5.8
 * @param {string} prdContent - Full PRD content
 * @returns {Object} Mapping of requirement IDs to implementation details
 */
function extractImplementationMapping(prdContent) {
  const mappings = {};

  // Look for Section 5.8 or "Implementation Mapping" section
  const sectionPattern = /#{1,3}\s*5\.8|#{1,3}\s*Implementation Mapping/i;
  const sectionMatch = prdContent.match(sectionPattern);

  if (sectionMatch) {
    const startIdx = sectionMatch.index;
    const headerEndMatch = prdContent.slice(startIdx).match(/\n/);
    const contentStartIdx = headerEndMatch
      ? startIdx + headerEndMatch.index + 1
      : startIdx;
    const sectionEndMatch = prdContent
      .slice(contentStartIdx)
      .match(/^#{1,3}\s[^#]/m);
    const sectionEnd = sectionEndMatch
      ? contentStartIdx + sectionEndMatch.index
      : prdContent.length;
    const sectionContent = prdContent.slice(contentStartIdx, sectionEnd);

    // Parse table rows: | Requirement | Files | Integration Points | Data Models |
    const rowPattern =
      /\|\s*([A-Z]+-\d+[a-z]?)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/g;

    let rowMatch;
    while (true) {
      rowMatch = rowPattern.exec(sectionContent);
      if (rowMatch === null) break;

      const reqId = rowMatch[1].trim().toLowerCase();
      const filesStr = rowMatch[2].trim();
      const pointsStr = rowMatch[3].trim();
      const modelsStr = rowMatch[4].trim();

      mappings[reqId] = {
        files: filesStr
          .split(/[,\s]+/)
          .map((f) => f.trim())
          .filter(Boolean),
        integrationPoints: pointsStr
          .split(/[,\s]+/)
          .map((p) => p.trim())
          .filter(Boolean),
        dataModels: modelsStr
          .split(/[,\s]+/)
          .map((m) => m.trim())
          .filter(Boolean),
        explicitMappingExists: true,
      };
    }
  }

  return mappings;
}

/**
 * Validate requirements have actionable implementation targets
 * @param {Array} requirements - Requirements to validate
 * @returns {Array} Warnings for requirements without implementation targets
 */
function validateRequirements(requirements) {
  const warnings = [];

  for (const req of requirements) {
    const hasFiles = req.files && req.files.length > 0;
    const hasIntegrationPoints =
      req.integrationPoints && req.integrationPoints.length > 0;
    const hasDataModels = req.dataModels && req.dataModels.length > 0;
    const hasExplicitMapping = req.explicitMappingExists === true;

    // Skip validation for non-implementation requirements (Setup, Docs, QA)
    if (req.type === 'Setup' || req.type === 'Docs' || req.type === 'QA') {
      continue;
    }

    // Requirement must have SOMETHING actionable
    if (
      !hasFiles &&
      !hasIntegrationPoints &&
      !hasDataModels &&
      !hasExplicitMapping
    ) {
      warnings.push(
        `${req.originalId}: No implementation target found. ` +
          `Add to Section 5.8 (Implementation Mapping) or reference in 5.2 (Integration Points) / 5.6 (Data Models)`,
      );
      
      // Auto-populate with placeholder to allow task creation
      req.files = req.files || ['TBD'];
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  PRD Validation Warnings:');
    console.warn(warnings.join('\n'));
    console.warn('\nProceeding with placeholder files (TBD)...\n');
  }
  
  return warnings;
}

/**
 * Enhanced context extraction with explicit mappings
 * @param {Object} req - Requirement object to enrich
 * @param {string} prdContent - Full PRD content
 * @param {Object} globalContext - Pre-extracted global context
 */
function extractRequirementContextEnhanced(req, prdContent, globalContext) {
  // Extract file:function() patterns from description
  const fileFuncPattern = /`?([\w/]+\.(?:go|js|ts|py|java|rs)):(\w+)\(\)`?/g;
  let fileMatch;
  while (true) {
    fileMatch = fileFuncPattern.exec(req.description);
    if (fileMatch === null) break;
    if (!req.files.includes(fileMatch[1])) {
      req.files.push(fileMatch[1]);
    }
    if (!req.functions.includes(fileMatch[2])) {
      req.functions.push(fileMatch[2]);
    }
  }

  // Apply explicit mappings from Section 5.8
  const implementationMapping = extractImplementationMapping(prdContent);
  if (implementationMapping[req.originalId.toLowerCase()]) {
    const mapping = implementationMapping[req.originalId.toLowerCase()];
    req.explicitMappingExists = true;

    // Add files from mapping
    for (const file of mapping.files) {
      if (!req.files.includes(file)) {
        req.files.push(file);
      }
    }
  }

  // Add integration points that explicitly reference this requirement
  for (const point of globalContext.integrationPoints) {
    if (point.requirements.includes(req.originalId)) {
      if (
        !req.integrationPoints.find((p) => p.pointNumber === point.pointNumber)
      ) {
        req.integrationPoints.push(point);
        if (point.file && !req.files.includes(point.file)) {
          req.files.push(point.file);
        }
        if (point.function && !req.functions.includes(point.function)) {
          req.functions.push(point.function);
        }
      }
    }
  }

  // Add data models that explicitly reference this requirement
  for (const model of globalContext.dataModels) {
    if (model.requirements.includes(req.originalId)) {
      if (!req.dataModels.find((m) => m.name === model.name)) {
        req.dataModels.push(model);
      }
    }
  }

  // Add configuration that explicitly references this requirement
  for (const config of globalContext.configuration) {
    if (config.requirements.includes(req.originalId)) {
      if (!req.configuration.includes(config.key)) {
        req.configuration.push(config.key);
      }
    }
  }
}

export {
  extractIntegrationPoints,
  extractDataModels,
  extractConfiguration,
  extractImplementationMapping,
  validateRequirements,
};

export { analyzePRDDeterministic as default };
