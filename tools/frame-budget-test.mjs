import assert from 'node:assert/strict';
import { simulationDelta, sampleFrameCost, nextQuality } from '../src/frame-budget.js';

const samples = [];
for (let i = 0; i < 120; i++) assert.equal(sampleFrameCost(samples, 0.08), null);
const sustained = sampleFrameCost(samples, 0.08);
assert.ok(Math.abs(sustained - 0.08) < 1e-12, 'render timing must use the unclamped elapsed frame delta');
assert.equal(samples.length, 0, 'the measured window must reset after a decision');
assert.equal(nextQuality('high', sustained), 'medium');
assert.equal(nextQuality('medium', sustained), 'low');
assert.equal(simulationDelta(0.08), 0.05, 'simulation advancement must keep its original catch-up cap');
assert.equal(nextQuality('high', 1 / 60), 'high', 'healthy frame rates must not downgrade');
assert.equal(nextQuality('medium', 0.06), 'medium', 'the second threshold remains distinct');
const resumed = Array(120).fill(0);
const stall = sampleFrameCost(resumed, 2);
assert.ok(Math.abs(stall - 0.25 / 121) < 1e-12, 'background/resume stalls are capped so one pause cannot dominate the window');
console.log('FRAME BUDGET PASSED — sustained slow frames trigger quality downgrade; sim step remains independently capped');
