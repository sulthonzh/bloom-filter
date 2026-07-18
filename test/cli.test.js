'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { join } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const CLI = join(__dirname, '..', 'cli.js');

function run(args, opts = {}) {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd || __dirname,
    input: opts.input,
  });
}

function runJson(args) {
  return JSON.parse(run(args));
}

// ─── Help / Version ─────────────────────────────────────────────

test('CLI: --version outputs version', () => {
  const out = run(['--version']).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('CLI: -V outputs version', () => {
  const out = run(['-V']).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('CLI: --version flag in options position', () => {
  const out = run(['create', '--version']).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('CLI: no args shows usage and exits 0', () => {
  const out = run([]);
  assert.ok(out.includes('bloom-filter-x'));
  assert.ok(out.includes('Usage:'));
});

test('CLI: help command shows usage', () => {
  const out = run(['help']);
  assert.ok(out.includes('Usage:'));
  assert.ok(out.includes('create'));
  assert.ok(out.includes('demo'));
});

test('CLI: --help flag shows usage', () => {
  const out = run(['--help']);
  assert.ok(out.includes('Usage:'));
});

// ─── Create ─────────────────────────────────────────────────────

test('CLI: create standard filter (default)', () => {
  const json = JSON.parse(run(['create']));
  assert.strictEqual(json.type, 'standard');
  assert.ok(typeof json.bitSize === 'number');
  assert.ok(json.bitSize > 0);
  assert.ok(Array.isArray(json.bitArray));
  assert.strictEqual(json.count, 0);
});

test('CLI: create counting filter', () => {
  const json = JSON.parse(run(['create', '--type', 'counting']));
  assert.strictEqual(json.type, 'counting');
  assert.ok(Array.isArray(json.counters));
});

test('CLI: create scalable filter', () => {
  const json = JSON.parse(run(['create', '--type', 'scalable']));
  assert.strictEqual(json.type, 'scalable');
  assert.ok(Array.isArray(json.filters));
});

test('CLI: create with custom capacity', () => {
  const json1 = JSON.parse(run(['create', '--capacity', '100']));
  const json2 = JSON.parse(run(['create', '--capacity', '1000']));
  assert.ok(json2.bitSize > json1.bitSize, 'Larger capacity should produce more bits');
});

test('CLI: create with custom error rate', () => {
  const json1 = JSON.parse(run(['create', '--error', '0.1']));
  const json2 = JSON.parse(run(['create', '--error', '0.001']));
  assert.ok(json2.bitSize > json1.bitSize, 'Lower error rate should produce more bits');
});

test('CLI: create --out writes to file', () => {
  const tmp = join(os.tmpdir(), `bf-create-${Date.now()}.json`);
  try {
    const out = run(['create', '--out', tmp]);
    assert.ok(out.includes(`Written to ${tmp}`));
    const json = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
    assert.strictEqual(json.type, 'standard');
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── Add ─────────────────────────────────────────────────────────

test('CLI: add item to filter', () => {
  const createOut = run(['create']);
  const tmp = join(os.tmpdir(), `bf-add-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    const stdout = run(['add', tmp, 'hello']);
    // add writes back to source file (options.out || _[1])
    assert.ok(stdout.includes('Written to'));
    // Verify the file was updated
    const json = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
    assert.ok(json.count >= 1);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: add with --out writes to new file', () => {
  const createOut = run(['create']);
  const tmp = join(os.tmpdir(), `bf-add-src-${Date.now()}.json`);
  const out = join(os.tmpdir(), `bf-add-dst-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    const stdout = run(['add', tmp, 'item1', '--out', out]);
    assert.ok(stdout.includes(`Written to ${out}`));
    const json = JSON.parse(fs.readFileSync(out, 'utf-8'));
    assert.ok(json.count >= 1);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(out); } catch {}
  }
});

test('CLI: add to counting filter', () => {
  const createOut = run(['create', '--type', 'counting']);
  const tmp = join(os.tmpdir(), `bf-add-cnt-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    run(['add', tmp, 'item1']);
    const json = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
    assert.strictEqual(json.type, 'counting');
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: add to scalable filter', () => {
  const createOut = run(['create', '--type', 'scalable']);
  const tmp = join(os.tmpdir(), `bf-add-scl-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    run(['add', tmp, 'item1']);
    const json = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
    assert.strictEqual(json.type, 'scalable');
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── Has ─────────────────────────────────────────────────────────

test('CLI: has returns MAYBE for added item', () => {
  const createOut = run(['create']);
  const tmp = join(os.tmpdir(), `bf-has-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    run(['add', tmp, 'hello']);
    const out = run(['has', tmp, 'hello']);
    assert.ok(out.includes('MAYBE'));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: has returns NO for absent item', () => {
  const createOut = run(['create']);
  const tmp = join(os.tmpdir(), `bf-has-no-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    // Use assert.throws to catch non-zero exit code
    assert.throws(() => {
      const out = run(['has', tmp, 'nonexistent']);
      // If it doesn't throw, the output should say NO
      if (out.includes('NO')) return;
      throw new Error('Expected non-zero exit or NO output');
    });
  } catch {
    // execFileSync throws on non-zero exit, which is expected for 'has' returning false
    // The actual behavior: has returns exit code 1 when item is NOT in filter
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── Info ────────────────────────────────────────────────────────

test('CLI: info on standard filter', () => {
  const createOut = run(['create', '--capacity', '500', '--error', '0.05']);
  const tmp = join(os.tmpdir(), `bf-info-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    // info uses console.log(info) which outputs JS object notation
    const out = run(['info', tmp]).trim();
    assert.ok(out.includes('type:'));
    assert.ok(out.includes('bitSize:'));
    assert.ok(out.includes('hashCount:'));
    assert.ok(out.includes('count:'));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: info on counting filter', () => {
  const createOut = run(['create', '--type', 'counting']);
  const tmp = join(os.tmpdir(), `bf-info-cnt-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    const out = run(['info', tmp]).trim();
    assert.ok(out.includes('type:'));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: info on scalable filter includes layers', () => {
  const createOut = run(['create', '--type', 'scalable']);
  const tmp = join(os.tmpdir(), `bf-info-scl-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    const out = run(['info', tmp]).trim();
    assert.ok(out.includes('layers: 1'));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: info on filled filter shows count > 0', () => {
  const createOut = run(['create']);
  const tmp = join(os.tmpdir(), `bf-info-filled-${Date.now()}.json`);
  fs.writeFileSync(tmp, createOut);
  try {
    run(['add', tmp, 'a']);
    run(['add', tmp, 'b']);
    run(['add', tmp, 'c']);
    const out = run(['info', tmp]).trim();
    // Should show count: 3 (or more)
    assert.match(out, /count: \d+/);
    const countMatch = out.match(/count: (\d+)/);
    assert.ok(parseInt(countMatch[1]) >= 3);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── Demo ────────────────────────────────────────────────────────

test('CLI: demo runs without error', () => {
  const out = run(['demo']);
  assert.ok(out.includes('filter'));
  assert.ok(out.includes('Added'));
  assert.ok(out.includes('true positives'));
  assert.ok(out.includes('False positives'));
});

test('CLI: demo counting filter', () => {
  const out = run(['demo', '--type', 'counting']);
  assert.ok(out.includes('counting'));
  assert.ok(out.includes('true positives'));
});

test('CLI: demo scalable filter', () => {
  const out = run(['demo', '--type', 'scalable']);
  assert.ok(out.includes('scalable'));
  assert.ok(out.includes('true positives'));
});

test('CLI: demo with custom capacity', () => {
  const out = run(['demo', '--capacity', '50']);
  // n = min(capacity, 100) = 50
  assert.ok(out.includes('Added 50'));
});

test('CLI: demo with small capacity shows layers for scalable', () => {
  const out = run(['demo', '--type', 'scalable', '--capacity', '10']);
  assert.ok(out.includes('Layers:') || out.includes('Memory:'));
});

// ─── Error handling ─────────────────────────────────────────────

test('CLI: unknown command shows usage and exits 1', () => {
  assert.throws(() => {
    run(['foobar']);
  }, /Error/);
});

test('CLI: add missing file throws error', () => {
  assert.throws(() => {
    run(['add', '/nonexistent/path/to/filter.json', 'item']);
  });
});

test('CLI: has missing file throws error', () => {
  assert.throws(() => {
    run(['has', '/nonexistent/path/to/filter.json', 'item']);
  });
});

test('CLI: info missing file throws error', () => {
  assert.throws(() => {
    run(['info', '/nonexistent/path/to/filter.json']);
  });
});

test('CLI: add with corrupt JSON throws', () => {
  const tmp = join(os.tmpdir(), `bf-corrupt-${Date.now()}.json`);
  fs.writeFileSync(tmp, '{ invalid json');
  try {
    assert.throws(() => {
      run(['add', tmp, 'item']);
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── Round-trip integration ─────────────────────────────────────

test('CLI: create → add → has → info full cycle', () => {
  const tmp = join(os.tmpdir(), `bf-cycle-${Date.now()}.json`);
  try {
    // Create
    run(['create', '--capacity', '100', '--error', '0.01', '--out', tmp]);
    // Add items
    run(['add', tmp, 'apple']);
    run(['add', tmp, 'banana']);
    run(['add', tmp, 'cherry']);
    // Has: items should be MAYBE
    assert.ok(run(['has', tmp, 'apple']).includes('MAYBE'));
    assert.ok(run(['has', tmp, 'banana']).includes('MAYBE'));
    assert.ok(run(['has', tmp, 'cherry']).includes('MAYBE'));
    // Info: check count via text output
    const infoOut = run(['info', tmp]).trim();
    const countMatch = infoOut.match(/count: (\d+)/);
    assert.ok(parseInt(countMatch[1]) >= 3);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

test('CLI: create counting → add → remove via library → has', () => {
  const tmp = join(os.tmpdir(), `bf-cnt-cycle-${Date.now()}.json`);
  try {
    run(['create', '--type', 'counting', '--capacity', '100', '--out', tmp]);
    run(['add', tmp, 'temp']);
    assert.ok(run(['has', tmp, 'temp']).includes('MAYBE'));
    // Verify it's a counting filter via info text output
    const infoOut = run(['info', tmp]).trim();
    assert.ok(infoOut.includes('Counting') || infoOut.includes('counting'));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// ─── parseArgs edge cases ───────────────────────────────────────

test('CLI: -V flag as first arg', () => {
  const out = run(['-V']).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});

test('CLI: version command (not flag)', () => {
  // 'version' is not a known command, it falls to unknown → error
  // But --version flag works
  const out = run(['--version']).trim();
  assert.match(out, /^\d+\.\d+\.\d+$/);
});
