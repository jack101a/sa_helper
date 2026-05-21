# STATE.md - System Default Import Bundle

## Status
COMPLETE

## Active Task
Created a clean system default import bundle for restoring captcha mappings, smart autofill rules, user scripts, question data, hashes, and one ONNX model on a new system.

## Findings
- Output bundle: `sa-helper-system-default-bundle.zip`.
- Included one model payload only: `files/data/models/217k_mixeed.onnx`.
- Normalized model registry, model routes, and field mappings to `217k_mixeed.onnx`.
- Captcha mappings were de-duplicated to 10 valid CSS mappings across 4 domains.
- Omitted the bare Vahan JSF selector alias `j_idt46:ref_captcha` because `document.querySelector()` requires the escaped CSS form; retained `#j_idt46\\:ref_captcha`.
- Autofill bundle uses the existing consolidated smart default rules from `extension/autofill_rules.json`, not the older repeated one-step spam rules.
- Included data files for mappings/userscripts, automation scripts, hashes, and questions.

## Last Files Modified
- `sa-helper-system-default-bundle.zip`
- `TASK.md`
- `STATE.md`

## Last Command Run
`python3` zip validation for `sa-helper-system-default-bundle.zip`

## Last Output/Error
- `checksum_ok True`
- `mismatches 0`
- `onnx_files ['files/data/models/217k_mixeed.onnx']`
- `all_model_refs ['217k_mixeed.onnx']`
- `autofill_rules 5`
- `field_mappings 10 {'echallan.parivahan.gov.in': 1, 'myaadhaar.uidai.gov.in': 1, 'sarathi.parivahan.gov.in': 6, 'vahan.parivahan.gov.in': 2}`
- `file_count_manifest 14`
- `files_entries 14`

## Verification Output Summary
- Manifest checksums match all bundle entries.
- Exactly one `.onnx` file is present in the bundle.
- Every model reference in `system-data.json` points to `217k_mixeed.onnx`.
- Bundle content includes system-data plus mappings/userscripts, automation scripts, hashes, questions, and the single model file.

## Immediate Next Step
Import `sa-helper-system-default-bundle.zip` using the system bundle import flow on the new system.
