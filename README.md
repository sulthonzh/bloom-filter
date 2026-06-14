# bloom-filter

Zero-dependency Bloom filter for probabilistic set membership testing. Standard, Counting (deletable), and Scalable variants.

## Why?

Bloom filters tell you if something is **definitely not** in a set, or **might be** in it — using a fraction of the memory. They power:

- **Caching** — skip lookups for keys that don't exist
- **Deduplication** — filter unique items before expensive comparison
- **Malicious URL detection** — check billions of URLs in kilobytes
- **Database optimization** — avoid disk seeks for absent rows
- **Distributed systems** — sync set membership with minimal bandwidth

## Quick Start

```js
const { BloomFilter } = require('bloom-filter');

const filter = BloomFilter.create(10000, 0.01); // 10k items, 1% FPR

filter.add('user@example.com');

filter.has('user@example.com');   // → true
filter.has('random@nowhere.com'); // → false (or true with ~1% chance)
```

## Three Variants

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
| `.toJSON()` / `.fromJSON()` | ✓ | ✓ | ✓ |

## CLI

```bash
bloom-filter create --capacity 10000 --out filter.json
bloom-filter add filter.json "user@example.com"
bloom-filter has filter.json "user@example.com"
bloom-filter info filter.json
bloom-filter demo --capacity 1000 --error 0.01
```

## How It Works

1. A bit array of size `m` (auto-computed)
2. `k` hash functions via double hashing: `g_i(x) = (h1(x) + i × h2(x)) % m`
3. **Add**: set `k` bits  •  **Check**: all `k` bits set → "maybe"; any bit 0 → "definitely not"

Optimal formulas: `m = -n·ln(p) / (ln2)²`, `k = (m/n)·ln2`

Zero dependencies. Node.js ≥ 14. MIT License.
