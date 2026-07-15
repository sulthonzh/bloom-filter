# Changelog

## v1.1.0 (2026-06-19)

### Performance
- **Popcount lookup table**: `fillRatio()` and `approximateCount()` now use an 8-bit popcount lookup table instead of iterating bit-by-bit — ~8x faster on large filters.

### Quality
- Eliminated code duplication: `_positions()`, `_setBit()`, `_getBit()` extracted to shared `computePositions()`, `setBit()`, `getBit()` helpers.
- Documented counter saturation behavior in `CountingBloomFilter.add()` and `.remove()` JSDoc.
- Exported `serialize()` for downstream testing.
- Added `--version` / `-V` flag to CLI.
- Added `exports` field, `files` field, `prepublishOnly` script to `package.json`.
- 3 real-world README examples + comparison table.
- 19 new tests (34 → 53 total).

## v1.0.0 (2026-06-15)

- Initial release: Standard, Counting, and Scalable Bloom filter variants.
- FNV-1a double hashing, optimal sizing, JSON serialization, CLI tool.
