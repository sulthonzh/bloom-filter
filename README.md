# bloom-filter-x

**Definitely not there, or maybe there — in O(1) time and minimal memory.**

Zero-dependency Bloom filter for probabilistic set membership testing. Standard, Counting (deletable), and Scalable variants.

## Why?

Bloom filters tell you if something is **definitely not** in a set, or **might be** in it — using a fraction of the memory of a hash table. They power:

- **Caching** — skip lookups for keys that don't exist
- **Deduplication** — filter unique items before expensive comparison
- **Malicious URL detection** — check billions of URLs in kilobytes
- **Database optimization** — avoid disk seeks for absent rows
- **Distributed systems** — sync set membership with minimal bandwidth

## Quick Start

```bash
npm install bloom-filter-x
```

```js
const { BloomFilter } = require('bloom-filter-x');

const filter = BloomFilter.create(10000, 0.01); // 10k items, 1% FPR

filter.add('user@example.com');

filter.has('user@example.com');   // → true
filter.has('random@nowhere.com'); // → false (or true with ~1% chance)
```

## Real-World Examples

### 1. Cache Penetration Shield (Redis + Bloom Filter)

Prevent cache-penetration attacks where bots query millions of non-existent keys, bypassing your cache and hitting the database:

```js
const { BloomFilter } = require('bloom-filter-x');

// Initialize with expected user base (1M users, 0.1% FPR)
const knownUsers = BloomFilter.create(1_000_000, 0.001);

// Load existing user IDs on startup
for (const id of existingUserIds) knownUsers.add(id);

function getUser(userId) {
  // Bloom filter check is O(1) — instant rejection of unknown keys
  if (!knownUsers.has(userId)) {
    return null; // definitely not a user — skip DB entirely
  }
  // Might be a user — check Redis, then DB
  return redis.get(`user:${userId}`) ?? db.users.findById(userId);
}
```

### 2. Malicious URL Checker (Scalable, Unknown Size)

URL blocklists grow constantly. ScalableBloomFilter auto-expands without pre-sizing:

```js
const { ScalableBloomFilter } = require('bloom-filter-x');
const sbf = new ScalableBloomFilter({ capacity: 100_000, errorRate: 0.001 });

// Stream URLs from threat intelligence feed
for await (const url of threatFeed) {
  sbf.add(url);
}

// Check incoming requests — zero false negatives guaranteed
function isBlocked(url) {
  return sbf.has(url); // true = maybe blocked, false = definitely safe
}

// Memory: ~1.2 MB for 100K URLs at 0.1% FPR
// vs ~6 MB for a Set of URL strings
console.log(`Using ${sbf.byteSize} bytes for ${sbf.count} URLs`);
```

### 3. Distributed Deduplication (Counting + Merge)

Multiple service instances each maintain a local CountingBloomFilter, then merge for global dedup:

```js
const { CountingBloomFilter } = require('bloom-filter-x');

class Deduplicator {
  constructor() {
    this.local = CountingBloomFilter.create(50_000, 0.01);
  }

  checkAndAdd(eventId) {
    if (this.local.has(eventId)) return false; // duplicate
    this.local.add(eventId);
    return true; // new event
  }

  remove(eventId) {
    return this.local.remove(eventId); // counters decrement — true deletion
  }

  snapshot() { return this.local.toJSON(); }
}
```

## Three Variants

| Variant | Memory | Delete? | Grows? | Use When |
|---------|--------|---------|--------|----------|
| **Standard** | Smallest | No | No | Size known upfront, items never removed |
| **Counting** | ~8x standard | Yes (counters) | No | Items added and removed |
| **Scalable** | Grows as needed | No | Yes | Size unknown, unbounded growth |

### Standard (`BloomFilter`)

Most memory-efficient. Items can't be removed once added.

```js
const bf = BloomFilter.create(1000, 0.01);
bf.add('hello');
bf.has('hello');    // true
bf.fillRatio();     // 0-1
bf.falsePositiveRate(); // current FPR estimate
```

### Counting (`CountingBloomFilter`)

Supports deletion via counters (~8x memory, but removable).

```js
const cbf = CountingBloomFilter.create(1000);
cbf.add('temp');
cbf.remove('temp'); // → true
```

### Scalable (`ScalableBloomFilter`)

Auto-grows when full. Use when size is unknown upfront.

```js
const sbf = new ScalableBloomFilter({ capacity: 100 });
for (let i = 0; i < 100000; i++) sbf.add(`item-${i}`);
sbf.numLayers; // auto-grown layers
```

## API

| Method | Standard | Counting | Scalable |
|--------|----------|----------|----------|
| `.add(item)` | ✓ | ✓ | ✓ |
| `.has(item)` | ✓ | ✓ | ✓ |
| `.remove(item)` | — | ✓ | — |
| `.fillRatio()` | ✓ | ✓ | — |
| `.falsePositiveRate()` | ✓ | — | — |
| `.approximateCount()` | ✓ | ✓ | — |
| `.merge(other)` | ✓ | — | — |
| `.isCompatibleWith(other)` | ✓ | — | — |
| `.toJSON()` / `.fromJSON()` | ✓ | ✓ | ✓ |

## CLI

```bash
bloom-filter-x create --capacity 10000 --out filter.json
bloom-filter-x add filter.json "user@example.com"
bloom-filter-x has filter.json "user@example.com"
bloom-filter-x info filter.json
bloom-filter-x demo --capacity 1000 --error 0.01
bloom-filter-x --version
```

## How It Works

1. A bit array of size `m` (auto-computed)
2. `k` hash functions via double hashing: `g_i(x) = (h1(x) + i × h2(x)) % m`
3. **Add**: set `k` bits  •  **Check**: all `k` bits set → "maybe"; any bit 0 → "definitely not"

Optimal formulas: `m = -n·ln(p) / (ln2)²`, `k = (m/n)·ln2`

## Comparison

| Feature | **bloom-filter-x** | [bloom-filters](https://www.npmjs.com/package/bloom-filters) | [bloomfilter](https://www.npmjs.com/package/bloomfilter) | [fast-bloom-filter](https://www.npmjs.com/package/fast-bloom-filter) |
|---------|------------------|-------------|-------------|-------------------|
| Dependencies | **0** | 3 | 0 | 1 |
| Variants | Standard + Counting + Scalable | Standard + Counting + Scalable | Standard only | Standard only |
| Merge filters | ✓ | ✗ | ✗ | ✗ |
| Auto-grow (Scalable) | ✓ | ✓ | ✗ | ✗ |
| CLI tool | ✓ | ✗ | ✗ | ✗ |
| JSON serialize | ✓ | ✓ | ✗ | ✓ |
| Memory (10K items, 1% FPR) | **~12 KB** | ~12 KB | ~12 KB | ~12 KB |
| Node.js ≥ | 14 | 12 | 8 | 12 |

Zero dependencies. Node.js ≥ 14. MIT License.
