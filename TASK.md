# TASK.md - System Default Import Bundle

## Goal
Create a portable system default import bundle from the provided backup data for restoring a new system.

## Status
COMPLETE

## Scope Included
- Preserve captcha domain field mappings from the provided backup/global routes.
- De-duplicate captcha field mappings by domain/source/target/model/task.
- Include bundled autofill rules as smart, single-pass defaults for checkbox/radio/select/click fields.
- Include user scripts, question data, hashes, mappings, and automation scripts from existing data files.
- Include only one ONNX model payload named `217k_mixeed.onnx`.
- Normalize model registry/routes/field mappings to reference `217k_mixeed.onnx`.

## Scope Excluded
- No autofill runner code changes.
- No user/account/API-key backup data.
- No extra duplicate ONNX model aliases.

## Plan
- [x] Inspect current bundle/import format.
- [x] Confirm available source files and existing default autofill rules.
- [x] Generate cleaned system-data and zip bundle.
- [x] Verify zip manifest checksums and contents.
- [x] Update STATE.md with output and verification.

## Verification
- `python3` zip validation confirmed all manifest checksums match.
- Bundle contains exactly one ONNX file: `files/data/models/217k_mixeed.onnx`.
- All model registry/routes/field mappings reference `217k_mixeed.onnx`.
- Counts: 5 autofill rules, 10 captcha field mappings, 4 allowed domains, 14 files entries.
