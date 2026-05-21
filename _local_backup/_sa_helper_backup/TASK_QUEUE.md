# TASK_QUEUE.md — UX Redesign Plan

## Phase 1: Design System & Foundation ✅
- [x] **T1.1** — Replace CDN Tailwind with proper build
- [ ] **T1.2** — Audit and standardize all theme class strings in `useTheme.js`
- [x] **T1.3** — Create centralized `endpoints.js` for all API paths
- [x] **T1.4** — Add route-level auth guards (`ProtectedRoute` component)
- [ ] **T1.5** — Extract reusable layout primitives

## Phase 2: Component Architecture ✅
- [x] **T2.1** — Split `SettingsPanel` into sub-components
- [x] **T2.2** — Create `ConfirmDialog` component
- [x] **T2.3** — Create `SearchInput` and `Pagination` reusable components
- [ ] **T2.4** — Migrate to React Query (partial — already using React Query for mutations)
- [ ] **T2.5** — Extract `DataTable` pattern

## Phase 3: Page-Level UX Improvements ✅
- [x] **T3.1** — `DashboardPanel`: Improve stat cards, payload queue table
- [x] **T3.2** — `KeysPanel`: Add search, pagination
- [x] **T3.3** — `ModelsPanel` + `MappingsPanel`: Better inline editing, search/filter
- [x] **T3.4** — `SubscriptionsPanel`: Consistent table UX, better filters
- [x] **T3.5** — `SettingsPanel` sections: Polish each sub-section
- [x] **T3.6** — `AutofillProposalsPanel` + `CaptchaProposalsPanel`: SearchInput, replace alert()
- [x] **T3.7** — `ExamStatsPanel` + `AutomationMethodsPanel`: Icon stat cards, error feedback
- [x] **T3.8** — `UserscriptsPanel`: SearchInput, icon header, contextual empty states

## Phase 4: Global UX Polish ✅
- [x] **T4.1** — Add loading skeletons to all panels consistently
- [x] **T4.2** — Add inline error states to all panels
- [x] **T4.3** — Add `React.memo` to frequently rendered components
- [x] **T4.4** — Improve mobile responsiveness across all panels
- [x] **T4.5** — Add keyboard navigation and focus management
- [x] **T4.6** — Accessibility audit: ARIA labels, color contrast, focus states

## Phase 5: Animation & Interaction ✅
- [x] **T5.1** — Add smooth page transitions between routes
- [x] **T5.2** — Add micro-interactions (button hover, loading states, success animations)
- [x] **T5.3** — Improve toast notification animations and positioning
- [x] **T5.4** — Add staggered animations for list/table items
- [x] **T5.5** — Reduce motion support for accessibility

## Phase 6: Final Review & Cleanup ✅
- [x] **T6.1** — Remove dead code, unused imports
- [x] **T6.2** — Final build verification and performance audit
- [x] **T6.3** — Code review and documentation update
