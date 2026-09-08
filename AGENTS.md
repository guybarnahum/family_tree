# AGENTS.md — family_tree continuity guide

Authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Read before substantial changes. Current code + explicit user instructions override historical notes.

## 1. Repo rules

- Work directly on `main` unless the user explicitly asks for a PR.
- Do **not** create PRs by default.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy/commits unless they actually succeeded.
- Normal user flow:

```bash
git pull
npm test
./deploy.sh
```

Production: `family.barnahum.com`.
Stack: Cloudflare Worker + D1 + R2 + static frontend.

## 2. Product model

One canonical global graph:

```text
People ↔ Relationships
```

The visible tree is ephemeral:

```text
selected person
+ canonical graph
+ projection rules
→ visible subgraph
→ one RenderController generation
```

Selecting another person reroots the projection. Side/collateral expansion state is ephemeral and clears on reroot.

## 3. Canonical topology invariants

Physical `nodes.parent_id` / `nodes.spouse_id` remain legacy columns; canonical topology is `relationships`.

- A person may have at most two explicit parents.
- Exactly two explicit parents must form a clean parent union; normalize a missing union edge.
- With 0 spouses, generic +child creates a sole-parent child.
- With 1 spouse, generic +child creates a child with both explicit parents.
- With 2+ spouses, generic +child must not execute; child creation is union-specific.
- Never guess a co-parent in a multi-spouse case.
- Adding a second parent must also ensure the parent union.

Names are canonicalized with NFC + trim + repeated-whitespace collapse.

## 4. Selection ownership — M4-A

`public/selection-controller.js` is the canonical active owner of:

```text
selected person ID
URL ?person=
localStorage["family-tree.anchor-person"]
selection events
browser history ownership
```

Important runtime behavior:

- ordinary card clicks are captured by SelectionController before graph-view's bubble reroot handler;
- URL + LocalStorage selection intent is coherent before projection starts;
- `FamilySelectionController.getSelectedPersonId()` is the canonical selected-person query;
- SelectionController installs the active `history.replaceState` / `history.pushState` functions;
- legacy feature wrappers may still assign history functions while bootstrap loads, but SelectionController reclaims them on `family-runtime-ready`;
- do not add another history/root persistence owner.

Current compatibility debt: `graph-view.js` and `person-pane.js` still contain historical history call/wrapper code internally. M4-C/D should remove the dead source paths; do not build new behavior on them.

Target committed invariant:

```text
SelectionController selected ID
=== graph-view projection root
=== RenderController rootId
=== the one DOM .graph-root
```

## 5. Projection / visual roles

`public/graph-view.js` owns person-centric projection mechanics.

Default intent:

- selected ancestry: eager recursive;
- selected descendants: eager recursive;
- selected spouse(s): visible;
- spouse ancestry: limited by default;
- selected person's siblings: visible and not gray;
- collateral branches: lazy behind +N;
- reroot clears expansions.

`public/visual-roles.js` is the only refinement owner for contextual/spouse-ancestry dimming.
The selected/committed root may never retain:

```text
graph-context
graph-spouse-parent
graph-spouse-ancestor-deep
```

RenderController passes the committed generation's exact root ID into the role pass.

## 6. Canonical client graph store — M3

`public/graph-store.js` is the single browser-side owner of the canonical graph document and shared indexes:

```text
graph
revision / serverRevision
stale / dirty
persistent snapshot
peopleById
parentsByChild
childrenByParent
spousesByPerson
```

Persistent key: `family-tree.graph-cache.v1`.

Clean reads stay in GraphStore. Stale/dirty reads perform one canonical `/api/graph` refresh. Authoritative structural intent must not write from a stale fallback.

Cross-module graph lifecycle events:

```text
family-graph-store-changed
family-graph-store-fetch
```

Do not recreate `FamilyGraphCache`, `family-graph-fetch`, or parallel graph caches for new application code.

## 7. Revision sync — M3

`public/graph-sync.js` owns revision polling policy through:

```text
GET /api/graph/revision
```

Policy:

```text
ACTIVE: visible + focused + activity <60s → every 5s
IDLE:   visible + focused + idle ≥60s    → every 15m
HIDDEN/BLURRED                           → no polling
focus/visible again                      → immediate check
```

Remote changes are coalesced; GraphStore is marked stale and graph-view uses the normal projection/render path.
Do not revive render tokens, settle windows, or duplicate-layout suppression.

## 8. Render + viewport ownership — M4-B

`public/render-controller.js` is the sole active owner of graph render generations and final viewport commits.

Pipeline:

```text
projection/cards
→ base geometry
→ relationship compaction
→ planar
→ member-order feedback
→ bridge compaction
→ planar-router final connector generation
→ assert
→ commit exactly one DOM .graph-root
→ visual roles / union controls
→ one center OR anchor restore
→ family-graph-rendered
```

A newer pending generation supersedes an older pending generation by serial ID.

### Explicit render intents

Feature code that genuinely changes geometry must call RenderController explicitly, e.g.:

```js
FamilyRenderController.requestLayout({
  reason: 'feature-reason',
  preserveAnchor: true
});
```

or `requestRecenter(...)`.

Current explicit geometry callers include name-width changes, portrait footprint changes, generation/breakpoint geometry, and controller-owned resize handling.

### Legacy facades are inert

After stage capture, global legacy calls are compatibility no-ops:

```text
layoutAndRender()
restoreAnchor(...)
```

They do **not** create render generations or viewport movement. Diagnostics count ignored requests:

```text
legacyLayoutRequestsIgnored
legacyViewportRequestsIgnored
```

Do not fix a bug by adding another RAF/timer/observer/centering pass. Express one explicit RenderController intent or fix the owning projection/stage.

### Root commit invariant

Before final role styling, RenderController makes `options.rootId` the only `.graph-root`, removes root dimming classes, and records `rootIdentityCommits`.

### Viewport invariant

Only the controller's final commit may center the root or restore a graph anchor. A structural/reroot generation must end with one final viewport operation.

## 9. Presentation / responsive behavior — M4-B

`public/presentation-refinement.js` is presentation-only:

- CSS + idle-name visual adjustment;
- listens to `family-graph-rendered`;
- no history wrapping;
- no card MutationObserver;
- no direct `layoutAndRender()`;
- no direct viewport centering;
- breakpoint geometry changes request RenderController explicitly.

`public/mobile-refinement.js` still contains historical layout-global mutations and old compatibility code. It is transitional debt to flatten in M4-F; do not copy that pattern.

## 10. Runtime/bootstrap

`src/entry.js` owns frontend asset serving/injection. It still strips two legacy inline startup statements from `public/index.html`:

- old 5-second full-tree poll;
- legacy initial `loadTree(null, true)`.

Foundation:

```text
graph-store
graph-status
person-identity
person-picker-labels
media-resilience
graph-view
runtime-bootstrap
```

`runtime-bootstrap.js` then installs selection/render ownership, feature modules, captures legacy layout algorithms as named stages, starts the first graph, then starts sync/debug.

Historical stage capture still uses temporary global replacement/function-name readiness. That is compatibility debt, not a pattern for new modules.

## 11. Known remaining architecture debt — M4-C through M4-G

M4-A/B establishes active ownership but does not yet physically delete every legacy source path.

Highest-value cleanup next:

1. **M4-C mutation/edit ownership** — replace legacy add/edit/delete/save wrapper chains with one explicit mutation layer.
2. **M4-D real shell** — remove live application logic/event handlers from `public/index.html`; stop server-side string surgery.
3. **M4-E transport** — remove chained global `window.fetch` wrappers in Store/sync/media; use one explicit API transport.
4. **M4-F layout stages** — convert captured monkey-patch modules into direct stage registration; delete sentinel scripts/function-name polling/global capture harness.
5. **M4-G deletion pass** — remove own-DOM MutationObservers, compatibility events, dead wrappers/comments/tests and low-value source-string tests.

Particularly important legacy sources still present today:

- `person-pane.js` contains old history/layout/centering code; active history/layout ownership is neutralized by M4-A/B, but source should be simplified in C/D.
- `mobile-refinement.js` still contains old direct layout/viewport/dynamic-loader code; active generic layout/anchor calls are inert, but source should be flattened in F.
- `index.html` still defines legacy app functions/event handlers; M4-D must make it a real shell.

## 12. Media / faces

D1 stores media/face metadata; originals live in R2. Media is associated with people.
Preferred face is `metadata.primaryFaceId`; it must belong to the person, otherwise deterministic fallback applies.

Portrait footprint:

- normal portrait: 40px diameter, left edge centered → 20px outside footprint;
- root portrait: 44px diameter → 22px outside footprint.

Portrait-set changes request one explicit RenderController layout; crop/primary changes for the same footprint should not relayout unnecessarily.

## 13. Person pane / metadata

Canonical metadata keys:

```text
birthDate
birthPlace
residence
deathDate
deathPlace
bio
primaryFaceId
```

Unchanged edits are true no-ops. Metadata changes should not cause topology redraw. Name changes may request one geometry refresh because card width can change.

## 14. New-person UX

After child/person creation:

- select/reroot appropriately;
- focus right-pane name editor;
- keyboard ready;
- on mobile open pane as needed.

Completely blank placeholders delete without confirmation; meaningful people remain protected.

## 15. Layout invariants

Current algorithm implementations remain in:

```text
public/index.html                 // legacy primitives, pending M4-D
public/layout-refinement.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
```

Preserve:

- explicit parent-pair/union semantics;
- multi-partner components;
- separate child groups for different unions;
- lineage-aware member order;
- required sibling/union contiguity;
- graph-safe bridge compaction;
- router avoidance/reporting of crossings/card intersections;
- ordinary one-partner geometry.

Do not redesign geometry while changing orchestration unless explicitly requested.

## 16. Deleted repair/cache remnants

Do not recreate:

```text
public/revision-layout-guard.js
public/graph-render-stability.js
public/root-selection-coherence.js
public/root-context-refinement.js
public/graph-cache.js
public/graph-resilience.js
```

## 17. Diagnostics

Useful browser diagnostics:

```js
window.__familyRuntimeBootstrapDiagnostics
window.__familySelectionDiagnostics
window.__familyGraphStoreDiagnostics
window.__familyRenderControllerDiagnostics
window.__familyVisualRoleDiagnostics
window.__familyLayoutDiagnostics
window.__familyMemberOrderDiagnostics
window.__familyBridgeDiagnostics
window.__familyRouteDiagnostics
```

For M4 ownership, pay special attention to:

```text
Selection: activeReplaceOwner / activePushOwner
Render: generationsStarted / committed / superseded
Render: legacyLayoutRequestsIgnored
Render: legacyViewportRequestsIgnored
Render: rootIdentityCommits
Render: viewportCommits
```

## 18. Tests

`npm test` runs behavioral/unit suites plus syntax checks. High-value suites include:

- graph/domain invariants;
- selection-controller;
- graph-store;
- visual roles;
- render-controller;
- runtime ownership;
- planar core;
- metadata/identity/faces.

M4 tests protect:

- legacy `layoutAndRender()` cannot create a render generation;
- one committed generation corrects a stale/wrong DOM root class;
- committed root cannot retain contextual/spouse-dimming classes;
- SelectionController reclaims history ownership after feature bootstrap;
- presentation does not own history/render/viewport;
- known geometry-changing features use explicit RenderController requests.

Prefer behavioral invariants over tests that merely match comments or arbitrary source spelling.

## 19. Browser translation / UI

Hebrew-first; browser translation is intentional. No app localization layer.

```html
<html lang="he" dir="rtl">
```

## 20. Current architectural north star

```text
GraphStore
   ↓
SelectionController
   ↓
GraphProjector
   ↓
RenderController
   ↓
LayoutEngine
   ↓
ConnectorRouter
   ↓
DOM + viewport
```

The non-negotiable runtime rule is:

```text
one selection
→ one root
→ one projection
→ one render generation
→ one layout
→ one connector generation
→ one final viewport operation
```
