#!/usr/bin/env node
/**
 * generate-spectral-overrides.js
 *
 * Reads a spec file, finds every operation with x-spectral-exemptions,
 * and writes a Spectral ruleset that:
 *   - extends the base ruleset
 *   - adds native `overrides` entries targeting those specific JSON Pointer paths
 *
 * Usage:
 *   node generate-spectral-overrides.js <spec.yaml> <base-ruleset.yaml> <output-ruleset.yaml>
 *
 * The output file is then passed directly to `spectral lint --ruleset`.
 */

const fs   = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const [,, specFile, baseRuleset, outputFile] = process.argv;

if (!specFile || !baseRuleset || !outputFile) {
  console.error('Usage: node generate-spectral-overrides.js <spec.yaml> <base-ruleset.yaml> <output-ruleset.yaml>');
  process.exit(2);
}

let spec;
try {
  spec = yaml.load(fs.readFileSync(specFile, 'utf8'));
} catch (e) {
  console.error(`Could not parse spec: ${e.message}`);
  process.exit(2);
}

// JSON Pointer encoding: / → ~1, ~ → ~0
function encodePointerSegment(segment) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

const HTTP_METHODS = ['get','post','put','patch','delete','head','options','trace'];
const overrides = [];
const paths = (spec && spec.paths) || {};

let exemptionCount = 0;

for (const [pathKey, pathItem] of Object.entries(paths)) {
  const encodedPath = encodePointerSegment(pathKey); // e.g. /tyres → ~1tyres

  // Path-level exemptions — applied as individual operation overrides for clarity
  const pathLevelExemptions = Array.isArray(pathItem['x-spectral-exemptions'])
    ? pathItem['x-spectral-exemptions']
    : [];

  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    if (!operation) continue;

    const operationExemptions = Array.isArray(operation['x-spectral-exemptions'])
      ? operation['x-spectral-exemptions']
      : [];

    // Merge path-level and operation-level exemptions
    const allExemptions = [...new Set([...pathLevelExemptions, ...operationExemptions])];
    if (allExemptions.length === 0) continue;

    // JSON Pointer for this operation: /paths/{path}/{method}
    const pointer = `#/paths/${encodedPath}/${method}`;
    const specFileName = path.basename(specFile);

    const rules = {};
    for (const ruleCode of allExemptions) {
      rules[ruleCode] = 'off';
      exemptionCount++;
    }

    overrides.push({
      files: [`${specFileName}${pointer}`],
      rules
    });

    console.log(`  Exempting ${allExemptions.join(', ')} at ${pathKey} [${method}]`);
  }
}

// Build the combined ruleset
const combined = {
  extends: [path.resolve(baseRuleset)],
  ...(overrides.length > 0 ? { overrides } : {})
};

fs.writeFileSync(outputFile, yaml.dump(combined, { lineWidth: -1 }));

console.log(`\nGenerated ruleset: ${outputFile}`);
console.log(`  Base ruleset:    ${baseRuleset}`);
console.log(`  Override blocks: ${overrides.length}`);
console.log(`  Exempted rules:  ${exemptionCount}`);
