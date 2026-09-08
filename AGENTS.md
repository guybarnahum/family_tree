# AGENTS.md — family_tree continuity guide

Authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Current code + explicit user instructions override historical notes.

## 1. Repo rules

- Work directly on `main` unless explicitly asked for a PR.
- Do not create PRs by default.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy/commits unless they actually succeeded.
- Name runtime modules and symbols by what they own, not by planning slices/milestones.
- Normal user flow:

```bash
git pull
npm test
./deploy.sh
```

Production: `family.barnahum.com`.
Stack: Cloudflare Worker + D1 + R2 + static frontend.

## 2. Product / topology invariants

One canonical global graph:

```text
People ↔ Relationships
```

The visible tree is an ephemeral person-centric projection around the selected person.

Canonical topology rules:

- at most two explicit parents;
- exactly two explicit parents must form a parent union;
- 0 spouses → generic +child has one explicit parent;
- 1 spouse → generic +child has both explicit parents;
- 2+ spouses → generic +child does not choose; use union-specific child action;
- never guess a co-parent;
- adding a second parent must ensure the parent union.

Names: NFC + trim + collapse repeated whitespace.

## 3. M4-A — selection ownership

`public/selection-controller.js` is the active browser owner of:

```text
selected person ID
URL ?person=
localStorage["family-tree.anchor-person"]
selection events
history.replaceState / history.pushState
```

Committed invariant:

```text
SelectionController ID
=== graph-view projection root
=== RenderController rootId
=== the one DOM .graph-root
```

Do not add another root/history persistence owner.

Some old history code remains inside `person-pane.js` / `graph-view.js` as compatibility source debt; active ownership is reclaimed by SelectionController. Remove that source debt in M4-F/G rather than building on it.

## 4. M3 — canonical GraphStore / sync

`public/graph-store.js` owns browser canonical graph state and shared indexes:

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

Clean graph reads stay in Store. Stale/dirty reads perform one canonical refresh. Authoritative structural intent must refresh before writing.

`public/graph-sync.js` owns revision polling. Do not revive render tokens, settle windows, or duplicate layout suppression.

## 5. M4-C — mutation/edit ownership

`public/family-mutations.js` is the canonical active owner of person/topology mutations.

Public API:

```js
FamilyMutations.updatePerson(...)
FamilyMutations.addChild(...)
FamilyMutations.addChildToUnion(...)
FamilyMutations.addParent(...)
FamilyMutations.addSpouse(...)
FamilyMutations.deletePerson(...)
```

Rules:

- structural intent starts from `FamilyGraphStore.refresh({ authoritative:true })`;
- structural edits use one transactional `PUT /api/graph` and then one canonical `loadTree()` refresh;
- person detail edits use one `PATCH /api/nodes/:id` path;
- unchanged person edits are true no-ops;
- card `[data-action]` dispatch is owned by FamilyMutations;
- `union-child-actions.js` is presentation-only and delegates to `FamilyMutations.addChildToUnion`;
- `person-pane-editing.js` saves pane fields through `FamilyMutations.updatePerson`;
- `pane-save-guard.js` was deleted.

Runtime bootstrap calls `installMutationFacade()` after historical stage capture so old mutation globals cannot remain active.

`public/legacy-symbols.js` contains inert transitional symbols required only while M4-F still loads old monkey-patch modules. Do not put behavior there.

## 6. M4-D — real shell / base core

`public/index.html` is now a shell only:

```text
fonts / Tailwind config
base CSS
header/status
scroll viewport
canvas
SVG layer
cards layer
```

It contains no graph loading, layout engine, mutation/edit handlers, polling, startup, resize rendering, or blur-save code.

`src/entry.js` injects versioned foundations; it no longer performs legacy inline string surgery.

Foundation order:

```text
legacy-symbols      // inert, temporary M4-F compatibility
family-core
graph-store
graph-status
family-mutations
person-identity
person-picker-labels
media-resilience
graph-view
runtime-bootstrap
```

`public/family-core.js` contains only foundational card/geometry primitives needed by the current captured layout algorithms:

```text
globalNodes / globalNodeMap / globalUnits
createCardHTML / renderCards
base family-unit construction
generation/order/packing primitives
connector path primitives
captureAnchor / restoreAnchor
showStatus
```

It must not own fetches, polling, startup, selection or mutations.

## 7. M4-B — RenderController / viewport ownership

`public/render-controller.js` owns active render generations and final viewport commits.

Pipeline:

```text
projection/cards
→ base geometry
→ relationship-compaction
→ planar
→ member-order feedback
→ bridge-compaction
→ planar-router
→ assert
→ commit exactly one DOM .graph-root
→ visual roles / union controls
→ one center OR anchor restore
→ family-graph-rendered
```

Feature code that changes geometry must use explicit controller intent:

```js
FamilyRenderController.requestLayout({ reason, preserveAnchor: true })
```

or `requestRecenter(...)`.

After capture, historical `layoutAndRender()` and `restoreAnchor(...)` calls are inert compatibility facades. Never fix render bugs by adding RAF/timer/observer/centering repair passes.

`public/graph-card-geometry.js` owns compact name-card generation spacing and topology-control geometry.

## 8. Projection / visual roles

`public/graph-view.js` owns person-centric projection mechanics.

Default intent:

- selected ancestry + descendants eager;
- selected spouses visible;
- spouse ancestry limited by default;
- selected person's siblings visible and not gray;
- collateral branches lazy behind +N;
- reroot clears expansions.

`public/visual-roles.js` is the only active owner of contextual/spouse-ancestry dimming.
The committed root may never retain:

```text
graph-context
graph-spouse-parent
graph-spouse-ancestor-deep
```

Historical bug note: real names were once misclassified as `default-node-text` because `innerText` was read while the hidden canvas was measuring. `node-hover.js` now classifies card fields from `textContent` after `family-graph-rendered`. Do not revert to layout-sensitive placeholder detection or own-DOM MutationObserver signaling.

## 9. Person pane / metadata

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

Cards are read-only topology/presentation; editing lives in the person pane.
Metadata edits should not cause topology redraw. Name changes may request one geometry refresh because card width can change.

New-person UX: after creation select/reroot, open/focus the pane name editor and make keyboard input ready. Completely blank placeholders delete without confirmation; meaningful/media-bearing people remain protected.

## 10. Media / faces

D1 stores metadata; originals live in R2. Media is associated with people.
Preferred face is `metadata.primaryFaceId`; it must belong to the person or deterministic fallback applies.

Structural graph replacement prunes `media_people` associations for deleted people on the server. Do not orphan media-person links.

## 11. Layout compatibility stack

Current proven layout algorithms remain:

```text
public/family-core.js
public/layout-refinement.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
```

`runtime-bootstrap.js` still captures several historical modules by temporarily replacing globals and waiting for expected function names. This is compatibility debt, not an acceptable pattern for new code.

Preserve layout behavior while flattening it later:

- parent-pair/union semantics;
- multi-partner components;
- distinct child groups for different unions;
- lineage-aware member order;
- sibling/union contiguity;
- final planar connector routing.

## 12. Remaining M4 work

M4-A through M4-D are active architecture.

Next cleanup:

1. **M4-E transport** — remove chained global `window.fetch` wrappers in Store/sync/media; use one explicit transport/API owner.
2. **M4-F layout stages** — replace monkey-patch/capture modules with direct stage registration; delete sentinel scripts, function-name polling, capture harness and `legacy-symbols.js`.
3. **M4-G deletion pass** — remove remaining own-DOM MutationObservers, dead history/save wrappers, compatibility events/comments and low-value source-string tests.

Do not combine M4-F algorithm cleanup with algorithm redesign.

## 13. Tests / diagnostics

`npm test` includes behavioral tests for:

- topology invariants;
- GraphStore;
- selection;
- visual roles;
- placeholder classification;
- FamilyMutations;
- runtime shell/ownership conformance;
- RenderController generations.

F1/debug diagnostics of interest:

```text
window.__familySelectionDiagnostics
window.__familyGraphStoreDiagnostics
window.__familyRenderControllerDiagnostics
window.__familyVisualRoleDiagnostics
window.__familyNodeTextDiagnostics
window.__familyMutationDiagnostics
window.__familyRuntimeBootstrapDiagnostics
```

Prefer behavioral regression tests. Avoid source-string assertions except for narrow architecture boundaries that cannot be cheaply tested behaviorally.
