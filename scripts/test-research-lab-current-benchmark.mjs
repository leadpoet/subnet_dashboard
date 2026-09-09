import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const route = await readFile(resolve('src/app/api/research-lab/route.ts'), 'utf8')
const component = await readFile(resolve('src/components/dashboard/ResearchLab.tsx'), 'utf8')

assert.match(route, /fetchResearchLabArena\(\)/)
assert.match(route, /normalizeResearchLabArenaSnapshot/)
assert.match(route, /arena: ResearchLabArenaSnapshot/)
assert.doesNotMatch(route, /fetchLatestBenchmark|fetchActivePromotedModelScore|private_baseline_rebenchmark/)
assert.doesNotMatch(route, /serving_model_version|activation_manifest_hash|model_artifact_hash/)
assert.doesNotMatch(component, /Retired rebenchmark detail|ResearchLabBenchmarkLineage|activePromotedModel|servingModelVersion/)
assert.match(component, /Open Source Agent Competition/)
assert.match(component, /Competition settlement and emissions/)

console.log('research-lab-current-benchmark: Arena is the sole public competition source and retired lineage is absent')
