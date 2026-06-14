#!/usr/bin/env node
'use strict';
const { BloomFilter, CountingBloomFilter, ScalableBloomFilter } = require('./index');
const fs = require('fs');

function usage() {
  console.log(`bloom-filter — Probabilistic set membership testing

Usage:
  bloom-filter create [--capacity N] [--error P] [--type standard|counting|scalable]
  bloom-filter add <filter.json> <item> [--out FILE]
  bloom-filter has <filter.json> <item>
  bloom-filter info <filter.json>
  bloom-filter demo [--capacity N] [--error P]

Commands:
  create    Create a new empty filter
  add       Add an item to a filter
  has       Check if item might be in the filter
  info      Show filter statistics
  demo      Run a demonstration

Options:
  --capacity N    Expected items (default 1000)
  --error P       Target false positive rate (default 0.01)
  --type T        standard | counting | scalable (default standard)
  --out FILE      Write output to file
  --json          Output JSON in demo`);
}

function parseArgs(argv) {
  const args = { _: [], options: {} };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (argv[i+1] && !argv[i+1].startsWith('--')) { args.options[key] = argv[++i]; }
      else args.options[key] = true;
    } else args._.push(argv[i]);
  }
  return args;
}

function loadFilter(path) {
  const json = JSON.parse(fs.readFileSync(path, 'utf-8'));
  if (json.type === 'counting') return CountingBloomFilter.fromJSON(json);
  if (json.type === 'scalable') return ScalableBloomFilter.fromJSON(json);
  return BloomFilter.fromJSON(json);
}

function output(data, outFile) {
  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (outFile) { fs.writeFileSync(outFile, str); console.log(`Written to ${outFile}`); }
  else console.log(str);
}

const { _, options } = parseArgs(process.argv.slice(2));
const cmd = _[0];

if (!cmd || cmd === 'help' || options.help) { usage(); process.exit(0); }

const capacity = parseInt(options.capacity || '1000', 10);
const errorRate = parseFloat(options.error || '0.01');
const type = options.type || 'standard';

if (cmd === 'create') {
  let filter;
  if (type === 'counting') filter = CountingBloomFilter.create(capacity, errorRate);
  else if (type === 'scalable') filter = new ScalableBloomFilter({ capacity, errorRate });
  else filter = BloomFilter.create(capacity, errorRate);
  output(filter.toJSON(), options.out);
} else if (cmd === 'add') {
  const filter = loadFilter(_[1]);
  filter.add(_[2]);
  output(filter.toJSON(), options.out || _[1]);
} else if (cmd === 'has') {
  const filter = loadFilter(_[1]);
  const exists = filter.has(_[2]);
  console.log(exists ? 'MAYBE (possibly in set)' : 'NO (definitely not in set)');
  process.exit(exists ? 0 : 1);
} else if (cmd === 'info') {
  const f = loadFilter(_[1]);
  const info = { type: f.constructor.name, bitSize: f.bitSize || 'N/A', hashCount: f.hashCount || 'N/A', count: f.count, byteSize: f.byteSize };
  if (f.fillRatio) info.fillRatio = f.fillRatio().toFixed(4);
  if (f.falsePositiveRate) info.estimatedFPR = f.falsePositiveRate().toExponential(3);
  if (f.numLayers !== undefined) info.layers = f.numLayers;
  console.log(info);
} else if (cmd === 'demo') {
  let filter;
  if (type === 'counting') filter = CountingBloomFilter.create(capacity, errorRate);
  else if (type === 'scalable') filter = new ScalableBloomFilter({ capacity, errorRate });
  else filter = BloomFilter.create(capacity, errorRate);
  const n = Math.min(capacity, 100);
  console.log(`${type} filter (cap=${capacity}, err=${errorRate})\n`);
  for (let i = 0; i < n; i++) filter.add(`user-${i}@example.com`);
  let tp = 0; for (let i = 0; i < n; i++) { if (filter.has(`user-${i}@example.com`)) tp++; }
  let fp = 0; for (let i = 0; i < 10000; i++) { if (filter.has(`random-${i}@test.com`)) fp++; }
  console.log(`Added ${n}, true positives ${tp}/${n} (100% expected)`);
  console.log(`False positives ${fp}/10000 (${(fp/100).toFixed(2)}% vs ${(errorRate*100).toFixed(2)}% target)`);
  if (filter.numLayers !== undefined) console.log(`Layers: ${filter.numLayers}`);
  console.log(`Memory: ${filter.byteSize} bytes`);
} else {
  console.error(`Unknown: ${cmd}`); usage(); process.exit(1);
}
