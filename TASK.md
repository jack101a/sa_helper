# TASK.md - T32-T34 Frontend Context + Plan Entitlements + Training Stats

## Goal
Execute tasks T32 through T34: extract App state into `AdminDataContext`, extend plan form with entitlement fields, and add training stats + force merge action in exam panel.

## Status
COMPLETE

## Scope Included
- Read mandatory plan/spec files and required frontend source files
- Implement T32 context extraction and thin `App.jsx` routing shell
- Implement T33 plan entitlement inputs (`max_devices`, `rate_limit_rpm`, `allowed_services`)
- Implement T34 training stats query and exam panel section with merge action
- Run required verification build
- Update `STATE.md`
- Commit with message: `[T32-T34] Frontend — AdminDataContext + plan entitlements UI + training stats`

## Scope Excluded
- Backend/API code changes
- Unrelated frontend refactors
- Destructive commands

## Plan
- [x] Read AGENTS.md, implementation plan, and T32-T34 task file
- [x] Read required frontend files before editing
- [x] Create `frontend/src/app/context/AdminDataContext.jsx`
- [x] Rewrite `frontend/src/app/App.jsx` as thin context-based routing shell
- [x] Add entitlement fields to `frontend/src/app/components/PlansPanel.jsx`
- [x] Add training stats query in `frontend/src/api/queries.js`
- [x] Add training stats UI + force merge button in `frontend/src/app/components/ExamStatsPanel.jsx`
- [x] Run `cd frontend && npm run build`
- [x] Update `STATE.md`
- [ ] Commit required frontend changes

## Verification
- `cd frontend && npm run build` -> PASS (Vite production build successful)
