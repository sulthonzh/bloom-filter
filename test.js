'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { BloomFilter, CountingBloomFilter, ScalableBloomFilter, computeBitSize, computeHashCount, hash32, serialize } = require('./index');

// Access internal helpers for testing
const { setBit, getBit } = (() => {
  // Re-create from module pattern for testing purposes
  const bf = new BloomFilter({ bitSize: 16, hashCount: 1 });
  return {
    setBit: (arr, p) => { arr[p >> 3] |= (1 << (p & 7)); },
    getBit: (arr, p) => { return (arr[p >> 3] & (1 << (p & 7))) !== 0; }
  };
})();

test('computeBitSize: valid size for typical params', () => {
  const m = computeBitSize(1000, 0.01);
  assert.ok(m >= 8000 && m <= 10000);
});

test('computeBitSize: higher error rate = fewer bits', () => {
  assert.ok(computeBitSize(1000, 0.1) < computeBitSize(1000, 0.01));
});

test('computeBitSize: throws on invalid params', () => {
  assert.throws(() => computeBitSize(0, 0.01), RangeError);
  assert.throws(() => computeBitSize(100, 0), RangeError);
  assert.throws(() => computeBitSize(100, 1), RangeError);
});

test('computeHashCount: returns valid count', () => {
  const k = computeHashCount(computeBitSize(1000, 0.01), 1000);
  assert.ok(k >= 1 && k <= 20);
});

test('BloomFilter.create: correct params', () => {
  const bf = BloomFilter.create(1000, 0.01);
  assert.ok(bf.bitSize >= 8000);
  assert.ok(bf.hashCount >= 1);
  assert.strictEqual(bf.count, 0);
});

test('BloomFilter: add + has for added items', () => {
  const bf = BloomFilter.create(100);
  bf.add('hello').add('world');
  assert.ok(bf.has('hello'));
  assert.ok(bf.has('world'));
});

test('BloomFilter: has returns false for non-added items', () => {
  const bf = BloomFilter.create(100);
  bf.add('hello');
  assert.ok(!bf.has('goodbye'));
});

test('BloomFilter: no false negatives ever', () => {
  const bf = BloomFilter.create(500, 0.01);
  const items = [];
  for (let i = 0; i < 500; i++) { items.push(`item-${i}`); bf.add(`item-${i}`); }
  for (const item of items) assert.ok(bf.has(item));
});

test('BloomFilter: false positive rate within bounds', () => {
  const cap = 1000, target = 0.01;
  const bf = BloomFilter.create(cap, target);
  for (let i = 0; i < cap; i++) bf.add(`item-${i}`);
  let fp = 0;
  for (let i = 0; i < 10000; i++) { if (bf.has(`other-${i}`)) fp++; }
  assert.ok(fp / 10000 < target * 3, `FPR ${fp/10000} too high`);
});

test('BloomFilter: handles non-string items', () => {
  const bf = BloomFilter.create(100);
  bf.add(42); bf.add({ name: 'test' }); bf.add([1,2,3]); bf.add(null); bf.add(true);
  assert.ok(bf.has(42));
  assert.ok(bf.has({ name: 'test' }));
  assert.ok(bf.has([1,2,3]));
  assert.ok(bf.has(null));
  assert.ok(bf.has(true));
  assert.ok(!bf.has(false));
});

test('BloomFilter: add is chainable', () => {
  const bf = BloomFilter.create(10);
  assert.strictEqual(bf.add('a'), bf);
});

test('BloomFilter: count tracks additions', () => {
  const bf = BloomFilter.create(100);
  for (let i = 0; i < 50; i++) bf.add(`item-${i}`);
  assert.strictEqual(bf.count, 50);
});

test('BloomFilter: fillRatio between 0 and 1', () => {
  const bf = BloomFilter.create(100, 0.1);
  assert.strictEqual(bf.fillRatio(), 0);
  bf.add('test');
  assert.ok(bf.fillRatio() > 0);
  for (let i = 0; i < 100; i++) bf.add(`x-${i}`);
  assert.ok(bf.fillRatio() > 0.3);
});

test('BloomFilter: falsePositiveRate increases with items', () => {
  const bf = BloomFilter.create(100, 0.01);
  const r0 = bf.falsePositiveRate();
  for (let i = 0; i < 80; i++) bf.add(`x-${i}`);
  assert.ok(bf.falsePositiveRate() > r0);
});

test('BloomFilter: approximateCount close to actual', () => {
  const bf = BloomFilter.create(1000, 0.01);
  for (let i = 0; i < 500; i++) bf.add(`item-${i}`);
  const est = bf.approximateCount();
  assert.ok(Math.abs(est - 500) / 500 < 0.2, `Estimate ${est} too far`);
});

test('BloomFilter: toJSON + fromJSON round-trip', () => {
  const bf = BloomFilter.create(100);
  bf.add('apple').add('banana').add('cherry');
  const restored = BloomFilter.fromJSON(bf.toJSON());
  assert.ok(restored.has('apple'));
  assert.ok(restored.has('banana'));
  assert.ok(restored.has('cherry'));
  assert.ok(!restored.has('grape'));
});

test('BloomFilter: toJSON correct structure', () => {
  const json = BloomFilter.create(50).toJSON();
  assert.strictEqual(json.type, 'standard');
  assert.ok(typeof json.bitSize === 'number');
  assert.ok(Array.isArray(json.bitArray));
});

test('BloomFilter: merge combines compatible filters', () => {
  const bf1 = BloomFilter.create(100); bf1.add('a').add('b');
  const bf2 = BloomFilter.create(100); bf2.add('c').add('d');
  const m = bf1.merge(bf2);
  assert.ok(m.has('a') && m.has('b') && m.has('c') && m.has('d'));
  assert.strictEqual(m.count, 4);
});

test('BloomFilter: merge throws on incompatible', () => {
  assert.throws(() => BloomFilter.create(100).merge(BloomFilter.create(200)), /Incompatible/);
});

test('BloomFilter: isCompatibleWith', () => {
  const bf1 = BloomFilter.create(100, 0.01);
  assert.ok(bf1.isCompatibleWith(BloomFilter.create(100, 0.01)));
  assert.ok(!bf1.isCompatibleWith(BloomFilter.create(200, 0.01)));
});

test('BloomFilter: byteSize', () => {
  const bf = BloomFilter.create(100, 0.01);
  assert.strictEqual(bf.byteSize, bf.bitArray.byteLength);
});

test('BloomFilter: empty filter returns false', () => {
  assert.ok(!BloomFilter.create(10).has('anything'));
});

test('BloomFilter: add empty string', () => {
  const bf = BloomFilter.create(10);
  bf.add('');
  assert.ok(bf.has(''));
});

test('BloomFilter: large number of items', () => {
  const bf = BloomFilter.create(10000, 0.01);
  for (let i = 0; i < 10000; i++) bf.add(`item-${i}`);
  assert.ok(bf.has('item-0'));
  assert.ok(bf.has('item-9999'));
  assert.ok(bf.has('item-5000'));
});

// CountingBloomFilter
test('CountingBloomFilter: add + has', () => {
  const cbf = CountingBloomFilter.create(100);
  cbf.add('hello').add('world');
  assert.ok(cbf.has('hello'));
  assert.ok(cbf.has('world'));
  assert.ok(!cbf.has('missing'));
});

test('CountingBloomFilter: remove works', () => {
  const cbf = CountingBloomFilter.create(100);
  cbf.add('temp');
  assert.ok(cbf.has('temp'));
  assert.ok(cbf.remove('temp'));
});

test('CountingBloomFilter: remove returns false for absent', () => {
  assert.ok(!CountingBloomFilter.create(100).remove('nothing'));
});

test('CountingBloomFilter: no false negatives after add/remove cycles', () => {
  const cbf = CountingBloomFilter.create(500, 0.01);
  for (let i = 0; i < 100; i++) { cbf.add(`junk-${i}`); cbf.remove(`junk-${i}`); }
  for (let i = 0; i < 50; i++) cbf.add(`real-${i}`);
  for (let i = 0; i < 50; i++) assert.ok(cbf.has(`real-${i}`), `False neg real-${i}`);
});

test('CountingBloomFilter: serialization round-trip', () => {
  const cbf = CountingBloomFilter.create(100);
  cbf.add('a').add('b');
  const r = CountingBloomFilter.fromJSON(cbf.toJSON());
  assert.ok(r.has('a'));
  assert.ok(r.has('b'));
});

// ScalableBloomFilter
test('ScalableBloomFilter: starts with one layer', () => {
  assert.strictEqual(new ScalableBloomFilter({ capacity: 100 }).numLayers, 1);
});

test('ScalableBloomFilter: add + has', () => {
  const sbf = new ScalableBloomFilter({ capacity: 100 });
  sbf.add('hello').add('world');
  assert.ok(sbf.has('hello'));
  assert.ok(sbf.has('world'));
  assert.ok(!sbf.has('missing'));
});

test('ScalableBloomFilter: grows when full', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50, errorRate: 0.01 });
  for (let i = 0; i < 200; i++) sbf.add(`item-${i}`);
  assert.ok(sbf.numLayers > 1);
});

test('ScalableBloomFilter: no false negatives after growth', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50 });
  for (let i = 0; i < 300; i++) sbf.add(`item-${i}`);
  for (let i = 0; i < 300; i++) assert.ok(sbf.has(`item-${i}`), `FN item-${i}`);
});

test('ScalableBloomFilter: serialization round-trip', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50 });
  sbf.add('a').add('b').add('c');
  const r = ScalableBloomFilter.fromJSON(sbf.toJSON());
  assert.ok(r.has('a'));
  assert.ok(r.has('b'));
  assert.ok(r.has('c'));
});

// ─── v1.1.0 additional tests ───────────────────────────────────────

test('serialize: handles all types', () => {
  assert.strictEqual(serialize('hello'), 'hello');
  assert.strictEqual(serialize(42), '42');
  assert.strictEqual(serialize(true), 'true');
  assert.strictEqual(serialize(null), 'null');
  assert.strictEqual(serialize(undefined), 'undefined');
  assert.strictEqual(serialize({ a: 1 }), '{"a":1}');
  assert.strictEqual(serialize([1, 2]), '[1,2]');
});

// Version flag test
const { execFileSync } = require('child_process');

test('CLI: --version flag outputs version', () => {
  const out = execFileSync('node', ['cli.js', '--version'], { encoding: 'utf-8' }).trim();
  assert.match(out, /^1\.1\.\d+$/);
});

test('CLI: -V flag outputs version', () => {
  const out = execFileSync('node', ['cli.js', '-V'], { encoding: 'utf-8' }).trim();
  assert.match(out, /^1\.1\.\d+$/);
});

// Counter saturation tests
test('CountingBloomFilter: counters saturate at 255', () => {
  const cbf = CountingBloomFilter.create(10, 0.1);
  // Add same item 300 times — counters should saturate at 255
  for (let i = 0; i < 300; i++) cbf.add('saturated');
  // Counter values should be capped at 255, not overflow
  const maxCounter = Math.max(...cbf.counters);
  assert.ok(maxCounter <= 255, `Counter overflowed: ${maxCounter}`);
  // Item should definitely be present
  assert.ok(cbf.has('saturated'));
});

test('CountingBloomFilter: remove after saturation leaves residual', () => {
  const cbf = CountingBloomFilter.create(10, 0.1);
  for (let i = 0; i < 300; i++) cbf.add('sat');
  // Remove once — counters still high, item still "maybe" present
  assert.ok(cbf.remove('sat'));
  // After one remove, counters are 254 — item likely still shows as present
  // This is expected documented behavior for counting bloom filters
  assert.ok(cbf.count === 299);
});

// Merge identity / edge cases
test('BloomFilter: merge with empty filter returns same bits', () => {
  const bf1 = BloomFilter.create(100);
  bf1.add('a').add('b');
  const empty = BloomFilter.create(100);
  const m = bf1.merge(empty);
  assert.ok(m.has('a'));
  assert.ok(m.has('b'));
  assert.strictEqual(m.count, 2);
});

test('BloomFilter: merge is commutative', () => {
  const bf1 = BloomFilter.create(100); bf1.add('x');
  const bf2 = BloomFilter.create(100); bf2.add('y');
  const m1 = bf1.merge(bf2);
  const m2 = bf2.merge(bf1);
  assert.ok(m1.has('x') && m1.has('y'));
  assert.ok(m2.has('x') && m2.has('y'));
});

// ScalableBloomFilter growth math
test('ScalableBloomFilter: layer capacity doubles', () => {
  const sbf = new ScalableBloomFilter({ capacity: 100, growthFactor: 2 });
  assert.strictEqual(sbf.filters[0]._capacity, 100);
  // Fill first layer
  for (let i = 0; i < 100; i++) sbf.add(`item-${i}`);
  // Next add triggers new layer
  sbf.add('trigger');
  assert.strictEqual(sbf.numLayers, 2);
  assert.strictEqual(sbf.filters[1]._capacity, 200);
});

test('ScalableBloomFilter: custom growth factor', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50, growthFactor: 4 });
  assert.strictEqual(sbf.filters[0]._capacity, 50);
  for (let i = 0; i < 50; i++) sbf.add(`item-${i}`);
  sbf.add('trigger');
  assert.strictEqual(sbf.filters[1]._capacity, 200); // 50 * 4
});

// Hash distribution sanity test
test('BloomFilter: hash positions are distinct for different items', () => {
  const bf = BloomFilter.create(1000, 0.01);
  const pos1 = new Set(bf._positions('item-a'));
  const pos2 = new Set(bf._positions('item-b'));
  // Different items should have at least some different positions
  const overlap = [...pos1].filter(p => pos2.has(p));
  // With k~7 hash functions, exact same positions for different items is astronomically unlikely
  assert.ok(overlap.length < bf.hashCount, 'Hash collision too high — all positions identical for different items');
});

// Popcount correctness
test('BloomFilter: fillRatio uses popcount correctly', () => {
  const bf = new BloomFilter({ bitSize: 16, hashCount: 2 });
  // Set 3 specific bits
  setBit(bf.bitArray, 0);
  setBit(bf.bitArray, 5);
  setBit(bf.bitArray, 15);
  // fillRatio should be 3/16
  assert.ok(Math.abs(bf.fillRatio() - 3/16) < 0.001);
});

// approximateCount edge cases
test('BloomFilter: approximateCount on empty filter returns 0', () => {
  const bf = BloomFilter.create(100);
  assert.strictEqual(bf.approximateCount(), 0);
});

test('BloomFilter: approximateCount on full filter returns Infinity', () => {
  const bf = new BloomFilter({ bitSize: 8, hashCount: 1 });
  // Set all 8 bits
  bf.bitArray[0] = 0xFF;
  assert.strictEqual(bf.approximateCount(), Infinity);
});

// CountingBloomFilter edge cases
test('CountingBloomFilter: add/remove/add cycle preserves correctness', () => {
  const cbf = CountingBloomFilter.create(100);
  cbf.add('cycle');
  assert.ok(cbf.has('cycle'));
  cbf.remove('cycle');
  // After remove, counter is 0 — should not have item
  // (unless false positive from other items, but filter is near-empty)
  // Note: there's a small chance it's still a false positive
  cbf.add('cycle');
  assert.ok(cbf.has('cycle'));
});

test('CountingBloomFilter: approximateCount on empty returns 0', () => {
  assert.strictEqual(CountingBloomFilter.create(100).approximateCount(), 0);
});

test('CountingBloomFilter: double remove returns false', () => {
  const cbf = CountingBloomFilter.create(100);
  cbf.add('once');
  assert.ok(cbf.remove('once'));
  assert.ok(!cbf.remove('once'));
});

// ScalableBloomFilter JSON structure
test('ScalableBloomFilter: toJSON has correct type', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50 });
  const json = sbf.toJSON();
  assert.strictEqual(json.type, 'scalable');
  assert.ok(Array.isArray(json.filters));
  assert.strictEqual(json.filters.length, 1);
});

test('ScalableBloomFilter: fromJSON preserves config', () => {
  const sbf = new ScalableBloomFilter({ capacity: 50, errorRate: 0.02, growthFactor: 3 });
  sbf.add('test');
  const r = ScalableBloomFilter.fromJSON(sbf.toJSON());
  assert.strictEqual(r.errorRate, 0.02);
  assert.strictEqual(r.growthFactor, 3);
  assert.ok(r.has('test'));
});

// Number of items stress test for fillRatio
test('BloomFilter: fillRatio approaches 1 for saturated filter', () => {
  const bf = BloomFilter.create(50, 0.5); // high FPR = fills quickly
  for (let i = 0; i < 500; i++) bf.add(`item-${i}`);
  assert.ok(bf.fillRatio() > 0.9, `Expected >0.9 fill, got ${bf.fillRatio()}`);
});
