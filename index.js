'use strict';

/**
 * @module bloom-filter
 * @description Zero-dependency Bloom filter for probabilistic set membership testing.
 * Standard, Counting (deletable), and Scalable variants.
 */

// ─── FNV-1a 32-bit hash ────────────────────────────────────────────

function hash32(str, seed) {
  let h = (seed >>> 0) || 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function serialize(item) {
  if (typeof item === 'string') return item;
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  return JSON.stringify(item);
}

// ─── Optimal sizing ────────────────────────────────────────────────

function computeBitSize(capacity, errorRate) {
  if (capacity <= 0) throw new RangeError('capacity must be > 0');
  if (errorRate <= 0 || errorRate >= 1) throw new RangeError('errorRate must be in (0, 1)');
  const m = Math.ceil(-capacity * Math.log(errorRate) / (Math.log(2) ** 2));
  return Math.max(8, m);
}

function computeHashCount(bitSize, capacity) {
  if (capacity <= 0) throw new RangeError('capacity must be > 0');
  return Math.max(1, Math.round((bitSize / capacity) * Math.log(2)));
}

// ─── BloomFilter ───────────────────────────────────────────────────

class BloomFilter {
  constructor(opts = {}) {
    if (typeof opts === 'number') {
      this.bitSize = opts;
      this.hashCount = arguments[1] || 1;
    } else {
      this.bitSize = opts.bitSize || computeBitSize(opts.capacity || 1000, opts.errorRate || 0.01);
      this.hashCount = opts.hashCount || computeHashCount(this.bitSize, opts.capacity || 1000);
    }
    this.bitArray = new Uint8Array(Math.ceil(this.bitSize / 8));
    this.count = 0;
  }

  static create(capacity, errorRate = 0.01) {
    const m = computeBitSize(capacity, errorRate);
    const k = computeHashCount(m, capacity);
    return new BloomFilter({ bitSize: m, hashCount: k });
  }

  _positions(item) {
    const s = serialize(item);
    const h1 = hash32(s, 0x811c9dc5);
    const h2 = hash32(s, 0x1505) || 1;
    const pos = new Array(this.hashCount);
    for (let i = 0; i < this.hashCount; i++) {
      pos[i] = ((h1 + i * h2) >>> 0) % this.bitSize;
    }
    return pos;
  }

  _setBit(p) { this.bitArray[p >> 3] |= (1 << (p & 7)); }
  _getBit(p) { return (this.bitArray[p >> 3] & (1 << (p & 7))) !== 0; }

  add(item) {
    for (const p of this._positions(item)) this._setBit(p);
    this.count++;
    return this;
  }

  has(item) {
    for (const p of this._positions(item)) {
      if (!this._getBit(p)) return false;
    }
    return true;
  }

  fillRatio() {
    let set = 0;
    for (let i = 0; i < this.bitSize; i++) {
      if (this._getBit(i)) set++;
    }
    return set / this.bitSize;
  }

  falsePositiveRate() {
    return Math.pow(1 - Math.exp(-this.hashCount * this.count / this.bitSize), this.hashCount);
  }

  approximateCount() {
    let set = 0;
    for (let i = 0; i < this.bitSize; i++) {
      if (this._getBit(i)) set++;
    }
    if (set === 0) return 0;
    if (set === this.bitSize) return Infinity;
    return Math.round(-(this.bitSize / this.hashCount) * Math.log(1 - set / this.bitSize));
  }

  get byteSize() { return this.bitArray.byteLength; }

  merge(other) {
    if (this.bitSize !== other.bitSize || this.hashCount !== other.hashCount) {
      throw new Error('Incompatible filters (different bitSize or hashCount)');
    }
    const merged = new BloomFilter({ bitSize: this.bitSize, hashCount: this.hashCount });
    for (let i = 0; i < this.bitArray.length; i++) {
      merged.bitArray[i] = this.bitArray[i] | other.bitArray[i];
    }
    merged.count = this.count + other.count;
    return merged;
  }

  isCompatibleWith(other) {
    return this.bitSize === other.bitSize && this.hashCount === other.hashCount;
  }

  toJSON() {
    return {
      type: 'standard',
      bitSize: this.bitSize,
      hashCount: this.hashCount,
      count: this.count,
      bitArray: Array.from(this.bitArray),
    };
  }

  static fromJSON(json) {
    const bf = new BloomFilter({ bitSize: json.bitSize, hashCount: json.hashCount });
    bf.bitArray = new Uint8Array(json.bitArray);
    bf.count = json.count || 0;
    return bf;
  }
}

// ─── CountingBloomFilter ───────────────────────────────────────────

class CountingBloomFilter {
  constructor(opts = {}) {
    if (typeof opts === 'number') {
      this.bitSize = opts;
      this.hashCount = arguments[1] || 1;
    } else {
      this.bitSize = opts.bitSize || computeBitSize(opts.capacity || 1000, opts.errorRate || 0.01);
      this.hashCount = opts.hashCount || computeHashCount(this.bitSize, opts.capacity || 1000);
    }
    this.counters = new Uint8Array(this.bitSize);
    this.count = 0;
  }

  static create(capacity, errorRate = 0.01) {
    const m = computeBitSize(capacity, errorRate);
    const k = computeHashCount(m, capacity);
    return new CountingBloomFilter({ bitSize: m, hashCount: k });
  }

  _positions(item) {
    const s = serialize(item);
    const h1 = hash32(s, 0x811c9dc5);
    const h2 = hash32(s, 0x1505) || 1;
    const pos = new Array(this.hashCount);
    for (let i = 0; i < this.hashCount; i++) {
      pos[i] = ((h1 + i * h2) >>> 0) % this.bitSize;
    }
    return pos;
  }

  add(item) {
    for (const p of this._positions(item)) {
      if (this.counters[p] < 255) this.counters[p]++;
    }
    this.count++;
    return this;
  }

  remove(item) {
    const positions = this._positions(item);
    for (const p of positions) {
      if (this.counters[p] === 0) return false;
    }
    for (const p of positions) {
      if (this.counters[p] > 0) this.counters[p]--;
    }
    this.count = Math.max(0, this.count - 1);
    return true;
  }

  has(item) {
    for (const p of this._positions(item)) {
      if (this.counters[p] === 0) return false;
    }
    return true;
  }

  approximateCount() {
    let sum = 0;
    for (let i = 0; i < this.bitSize; i++) sum += this.counters[i];
    return Math.round(sum / this.hashCount);
  }

  fillRatio() {
    let nonZero = 0;
    for (let i = 0; i < this.bitSize; i++) {
      if (this.counters[i] > 0) nonZero++;
    }
    return nonZero / this.bitSize;
  }

  get byteSize() { return this.counters.byteLength; }

  toJSON() {
    return {
      type: 'counting',
      bitSize: this.bitSize,
      hashCount: this.hashCount,
      count: this.count,
      counters: Array.from(this.counters),
    };
  }

  static fromJSON(json) {
    const cbf = new CountingBloomFilter({ bitSize: json.bitSize, hashCount: json.hashCount });
    cbf.counters = new Uint8Array(json.counters);
    cbf.count = json.count || 0;
    return cbf;
  }
}

// ─── ScalableBloomFilter ───────────────────────────────────────────

class ScalableBloomFilter {
  constructor(opts = {}) {
    this.errorRate = opts.errorRate || 0.01;
    this.initialCapacity = opts.capacity || 1000;
    this.growthFactor = opts.growthFactor || 2;
    this.tighteningRatio = opts.tighteningRatio || 0.85;
    this.filters = [];
    this.count = 0;
    this._addFilter();
  }

  _addFilter() {
    const layer = this.filters.length;
    const capacity = Math.floor(this.initialCapacity * Math.pow(this.growthFactor, layer));
    const errorRate = this.errorRate * Math.pow(this.tighteningRatio, layer);
    const bf = BloomFilter.create(capacity, Math.max(errorRate, 1e-9));
    bf._capacity = capacity;
    this.filters.push(bf);
  }

  add(item) {
    const current = this.filters[this.filters.length - 1];
    if (current.count >= current._capacity) {
      this._addFilter();
    }
    this.filters[this.filters.length - 1].add(item);
    this.count++;
    return this;
  }

  has(item) {
    for (const f of this.filters) {
      if (f.has(item)) return true;
    }
    return false;
  }

  get numLayers() { return this.filters.length; }

  get byteSize() {
    return this.filters.reduce((sum, f) => sum + f.byteSize, 0);
  }

  toJSON() {
    return {
      type: 'scalable',
      errorRate: this.errorRate,
      initialCapacity: this.initialCapacity,
      growthFactor: this.growthFactor,
      tighteningRatio: this.tighteningRatio,
      count: this.count,
      filters: this.filters.map(f => f.toJSON()),
    };
  }

  static fromJSON(json) {
    const sbf = Object.create(ScalableBloomFilter.prototype);
    sbf.errorRate = json.errorRate;
    sbf.initialCapacity = json.initialCapacity;
    sbf.growthFactor = json.growthFactor;
    sbf.tighteningRatio = json.tighteningRatio;
    sbf.count = json.count;
    sbf.filters = json.filters.map(f => BloomFilter.fromJSON(f));
    return sbf;
  }
}

module.exports = { BloomFilter, CountingBloomFilter, ScalableBloomFilter, computeBitSize, computeHashCount, hash32 };
