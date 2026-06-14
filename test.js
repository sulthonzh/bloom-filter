'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { BloomFilter, CountingBloomFilter, ScalableBloomFilter, computeBitSize, computeHashCount } = require('./index');

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
