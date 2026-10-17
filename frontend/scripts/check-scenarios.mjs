import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const matrix = readFileSync(new URL('../docs/acceptance.md', root), 'utf8');
const documented = new Set([...matrix.matchAll(/^\| ([A-Z]+-\d+) \|/gm)].map((match) => match[1]));
const tested = new Set();
for (const file of readdirSync(new URL('cypress/e2e/', root)).filter((file) => file.endsWith('.cy.ts'))) {
  const source = readFileSync(new URL(`cypress/e2e/${file}`, root), 'utf8');
  if (/\b(?:it|describe)\.(?:only|skip)\s*\(/.test(source)) {
    throw new Error(`Focused or skipped scenarios are not allowed: ${file}`);
  }
  for (const match of source.matchAll(/\bit\(\s*['"`]([A-Z]+-\d+)/g)) tested.add(match[1]);
}
const missing = [...documented].filter((id) => !tested.has(id));
const unknown = [...tested].filter((id) => !documented.has(id));
if (!documented.size || missing.length || unknown.length) {
  throw new Error(`Scenario traceability failed (${fileURLToPath(root)}): missing=${missing.join(',')}; undocumented=${unknown.join(',')}`);
}
console.log(`${documented.size} documented UI scenarios mapped to Cypress specs (bidirectional)`);
