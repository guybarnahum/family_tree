# AGENTS.md — family_tree continuity guide

Authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Current code + explicit user instructions override historical notes.

## 1. Repo rules

- Work directly on `main` unless explicitly asked for a PR.
- Do not create PRs by default.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy unless actually observed.
- Fix defects at the owning abstraction/source of truth; do not add downstream repair layers.
- Delete superseded wrappers, timers, observers, caches and compatibility code when their owner replaces them.
- Name modules by runtime ownership, not planning milestones.

Normal user flow:

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

- at most two explicit parents;
- exactly two explicit parents must form a parent union;
- 0 spouses → generic +child has one explicit parent;
- 1 spouse → generic +child has both explicit parents;
- 2+ spouses → generic +child does not choose; use union-specific child action;
- never guess a co-parent;
- adding a second parent must ensure the parent union.

Names: NFC + trim + collapse repeated whitespace.

## 3. Selection ownership — M4-A

`public/selection-controller.js` owns:

```text
selected person ID
URL ?person=
localStorage["family-tree.anchor-person"]
selection events
history.replaceState / history.pushState
```

Invariant:

```text
SelectionController ID
=== GraphView projection root
=== RenderController rootId
=== the one DOM .graph-root
```

SelectionController is a foundation loaded before GraphView. GraphView consumes selection events and does not write history.
Some source debt such as old feature history wrappers may still exist; remove it in M4-G, never build on it.

## 4. Canonical graph / sync — M3

`public/graph-store.js` owns:

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

Clean graph reads stay in Store. Stale/dirty reads perform one canonical refresh. Authoritative structural intent refreshes before writing.
`public/graph-sync.js` owns revision polling and consumes FamilyApi/Store events; it does not wrap fetch.

## 5. Mutation/edit ownership — M4-C

`public/family-mutations.js` is the canonical mutation owner:

```js
FamilyMutations.updatePerson(...)
FamilyMutations.addChild(...)
FamilyMutations.addChildToUnion(...)
FamilyMutations.addParent(...)
FamilyMutations.addSpouse(...)
FamilyMutations.deletePerson(...)
FamilyMutations.putGraph(...)
```

- structural intent starts from `FamilyGraphStore.refresh({ authoritative:true })`;
- structural edits use one transactional `PUT /api/graph` then one canonical graph refresh;
- person edits use one `PATCH /api/nodes/:id` path;
- unchanged person edits are true no-ops;
- card `[data-action]` dispatch belongs to FamilyMutations;
- union-child UI delegates to `addChildToUnion`;
- person-pane editing delegates to `updatePerson`.

The duplicate mutation implementation formerly in multi-partner layout was deleted in M4-F.
`pane-save-guard.js` and `legacy-symbols.js` are deleted.

## 6. Shell / foundations — M4-D

`public/index.html` is a shell only: fonts/Tailwind/base CSS, header/status, viewport, canvas, SVG layer and cards layer.
It contains no graph loading, layout engine, mutations, polling, startup or blur-save code.

`src/entry.js` injects foundations in this order:

```text
family-core
selection-controller
family-api
graph-store
graph-status
family-mutations
person-identity
person-picker-labels
graph-view
runtime-bootstrap
```

Foundation scripts are marked `data-family-bootstrap-loaded="true"` so bootstrap does not wait on already-fired load events.

`public/family-core.js` owns base card/geometry primitives only. It must not own application data I/O, polling, selection or mutations.

## 7. Explicit browser transport — M4-E COMPLETE

`public/family-api.js` is the sole browser application transport owner.
It owns:

```text
native fetch capture
request/json helpers
revision header parsing
family-api-mutation events
resilient media catalog reads
resilient preferred-face catalog reads
```

Rules:

- FamilyApi captures native fetch once but never assigns `window.fetch`;
- GraphStore and GraphSync do not capture/wrap fetch;
- successful graph/media/face mutations emit one `family-api-mutation`;
- GraphStore consumes mutation events for dirty/revision state;
- GraphSync consumes them for revision/session metrics;
- `media-resilience.js` is deleted; fallback belongs in FamilyApi;
- GraphView reads canonical data only through GraphStore;
- import/export reads through Store and writes through FamilyMutations;
- person media, face tagging, face preference and place lookup use FamilyApi explicitly;
- face tagging reads people from GraphStore, never `/api/graph`.

Do not reintroduce a global fetch compatibility wrapper.

## 8. Projection / visual roles

`public/graph-view.js` owns person-centric projection mechanics only.
Canonical data comes from GraphStore, selected root from SelectionController, layout/viewport commits from RenderController.

Default projection intent:

- selected ancestry + descendants eager;
- selected spouses visible;
- spouse ancestry limited by default;
- selected person's siblings visible and `viewRole: "sibling"`, never generic context;
- collateral branches lazy behind +N;
- reroot clears expansions.

`public/visual-roles.js` translates committed projection semantics (`root / primary / sibling / context`) plus spouse-ancestry policy into visual classes. It must not reconstruct siblinghood from layout fields.

Historical placeholder bug: `node-hover.js` intentionally classifies card text from `textContent` after `family-graph-rendered`; do not use layout-sensitive `innerText` while the canvas is hidden.

## 9. Render / layout ownership — M4-B + M4-F COMPLETE

`public/render-controller.js` owns render generations, stage execution, final connector generation, final validation and viewport commit.

Pipeline:

```text
projection/cards
→ base geometry
→ relationship-compaction
→ planar
→ member-order feedback
→ bridge-compaction
→ planar-router            // one final connector generation
→ assert
→ planar validation        // explicit final validator
→ commit exactly one DOM .graph-root
→ visual roles / union controls
→ one center OR anchor restore
→ family-graph-rendered
```

Direct registered modules:

```text
multi-partner-refinement   prepare:10 + family-unit/union primitives
layout-refinement          layout:20 relationship-compaction
planar-layout              prepare/layout:30 + validate:30
member-order-refinement    prepare/layout:40, ownsPrefix
bridge-compaction          prepare/layout:50
planar-router              prepare:60 + connector owner
```

M4-F removed:

```text
captureLegacyModule
setLayout / setLoadTree
function-name stage polling
captured RAF callbacks
dummy bootstrap sentinel scripts
legacy-symbols.js
layout/loadTree monkey patches
private /api/graph caches in layout modules
multi-partner duplicate mutation code
```

All topology-aware layout modules consume FamilyGraphStore indexes during their prepare stage.
Member-order retains the same feedback behavior by explicitly calling `FamilyRenderController.runThrough('planar')`.
Planar crossing/card-intersection diagnostics run as an explicit final validator, after final routing.

The controller still exposes inert `layoutAndRender` / `restoreAnchor` compatibility facades because old presentation modules call them. That boundary is M4-G debt; do not make those calls active again.

Feature geometry changes must use:

```js
FamilyRenderController.requestLayout({ reason, preserveAnchor: true })
```

or `requestRecenter(...)`.
Never fix rendering with corrective RAF/timer/observer/centering passes.

## 10. Mobile/presentation dependency note

`mobile-refinement.js` installs generation-centered primitives and currently dynamically loads presentation + multi-partner modules. Bootstrap waits on semantic install guards:

```text
__familyPresentationRefinementInstalled
__familyMultiPartnerRefinement
```

The old fake script-sentinel mechanism is gone. Removing mobile's remaining dynamic dependency loading is optional M4-G cleanup; do not reorder multi-partner ahead of mobile generation-center primitives without checking geometry behavior.

## 11. Person pane / metadata

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

New-person UX: after creation select/reroot, open/focus the pane name editor and make keyboard input ready. Blank placeholders delete without confirmation; meaningful/media-bearing people remain protected.

## 12. Media / faces

D1 stores metadata; originals live in R2. Media is associated with people.
Preferred face is `metadata.primaryFaceId`; it must belong to the person or deterministic fallback applies.
Structural graph replacement prunes media-person associations for deleted people on the server.

Graph-card face decoration uses committed render lifecycle rather than observing graph card child-list changes.
Modal-local observers for face-editor state are legitimate UI-local observers.

## 13. M4-G — remaining deletion pass

M4-A through M4-F are active architecture. Remaining cleanup should be reductive:

- remove remaining own-graph-DOM MutationObservers; keep only genuinely UI-local/external observers;
- remove old history wrappers from person-pane/other features now that SelectionController is foundational;
- remove remaining direct `layoutAndRender` / `restoreAnchor` callers, then delete RenderController's inert compatibility facade and related diagnostics;
- remove `family-graph-render-stable` after its final listener migrates to `family-graph-rendered`;
- simplify mobile's dynamic dependency loading if safe;
- consolidate/delete print polish/refinement overlap;
- remove stale milestone/slice comments and low-value source-string tests when equivalent behavioral tests exist.

Do not redesign the proven layout algorithms during M4-G.

## 14. Tests / diagnostics

`npm test` covers topology invariants, FamilyApi, GraphStore, selection, visual roles, placeholder classification, mutations, runtime ownership/conformance and RenderController generations/validation.

Diagnostics:

```text
window.__familySelectionDiagnostics
window.__familyGraphStoreDiagnostics
window.__familyRenderControllerDiagnostics
window.__familyLayoutDiagnostics
window.__familyRouteDiagnostics
window.__familyMemberOrderDiagnostics
window.__familyBridgeDiagnostics
window.__familyVisualRoleDiagnostics
window.__familyNodeTextDiagnostics
window.__familyMutationDiagnostics
window.__familyRuntimeBootstrapDiagnostics
```

Prefer behavioral regression tests. Keep source-string assertions only for narrow architecture boundaries that are otherwise expensive to exercise.
