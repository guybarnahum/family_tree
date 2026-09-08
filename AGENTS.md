# AGENTS.md — family_tree continuity guide

Authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Current code + explicit user instructions override historical notes.

## 1. Repo rules

- Work directly on `main` unless explicitly asked for a PR.
- Do not create PRs by default.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy/commits unless they actually succeeded.
- Name runtime modules and symbols by what they own, not by planning slices/milestones.
- Always fix defects at their root cause and owning abstraction/source of truth. Do not cover an upstream semantic, ownership, lifecycle, or data-model defect by adding compensating code downstream.
- When a proper fix makes a workaround, compatibility shim, repair pass, observer, timer, wrapper, fallback classifier, or duplicated inference unnecessary, delete the superseded code in the same change whenever safe.
- Before adding new logic for a bug, ask which existing owner should have produced the correct state. Prefer correcting that owner over teaching later layers to recognize and repair bad state.
- A fix is not complete merely because the symptom disappears; the runtime should become simpler or at least no more layered than before.
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

SelectionController is now a foundation loaded before GraphView. GraphView consumes selection events; it does not write history itself.
Some old history wrappers remain in feature source such as `person-pane.js`; remove them in M4-G rather than building on them.

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

`public/graph-sync.js` owns revision polling. It consumes explicit `FamilyApi` mutation events and GraphStore fetch events; it does not wrap `window.fetch`.
Do not revive render tokens, settle windows, or duplicate layout suppression.

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
FamilyMutations.putGraph(...)
```

Rules:

- structural intent starts from `FamilyGraphStore.refresh({ authoritative:true })`;
- structural edits use one transactional `PUT /api/graph` and then one canonical graph refresh;
- person detail edits use one `PATCH /api/nodes/:id` path;
- browser transport goes through `FamilyApi`;
- unchanged person edits are true no-ops;
- card `[data-action]` dispatch is owned by FamilyMutations;
- `union-child-actions.js` is presentation-only and delegates to `FamilyMutations.addChildToUnion`;
- `person-pane-editing.js` saves pane fields through `FamilyMutations.updatePerson`;
- `pane-save-guard.js` was deleted.

Runtime bootstrap still calls `installMutationFacade()` after historical stage capture so old mutation globals cannot remain active. This facade is M4-F/G compatibility debt.

`public/legacy-symbols.js` contains inert transitional symbols required only while M4-F still loads old monkey-patch modules. Do not put behavior there.

## 6. M4-D — real shell / base core

`public/index.html` is a shell only:

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

`public/family-core.js` contains foundational card/geometry primitives needed by the current captured layout algorithms:

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

`public/graph-view.js` owns person-centric projection mechanics only. Canonical data comes from GraphStore, selected root comes from SelectionController, and layout/viewport commits go to RenderController.
It no longer fetches `/api/graph`, writes history, wraps `saveEdit`, or has a legacy RAF/layout fallback.

Default projection intent:

- selected ancestry + descendants eager;
- selected spouses visible;
- spouse ancestry limited by default;
- selected person's siblings visible and `viewRole: "sibling"`, never generic context;
- collateral branches lazy behind +N;
- reroot clears expansions.

`public/visual-roles.js` translates committed projection semantics (`root / primary / sibling / context`) plus spouse-ancestry policy into visual classes. It must not rediscover siblinghood from Store/layout fields.
The committed root or selected person's sibling may never retain contextual/spouse-ancestry dimming classes.

Historical bug note: real names were once misclassified as `default-node-text` because `innerText` was read while the hidden canvas was measuring. `node-hover.js` now classifies card fields from `textContent` after `family-graph-rendered`. Do not revert to layout-sensitive placeholder detection or own-DOM MutationObserver signaling.

## 9. M4-E — explicit browser transport

`public/family-api.js` is the browser transport owner.

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

- `FamilyApi` captures native fetch once but never assigns `window.fetch`;
- GraphStore and GraphSync must not capture or wrap fetch;
- successful graph/media/face mutations emit one `family-api-mutation` with method/path/scope/revision;
- GraphStore consumes that event for dirty/revision state;
- GraphSync consumes it for revision/session metrics;
- `public/media-resilience.js` was deleted; its catalog fallback belongs in FamilyApi;
- GraphView reads only through GraphStore;
- import/export reads through GraphStore and writes through FamilyMutations;
- place lookup and migrated face features call FamilyApi directly.

Remaining transport migration debt before M4-E can be called fully complete:

```text
public/person-media.js
public/face-tagging.js
```

They still contain direct browser API calls and must move to FamilyApi. Do not solve this with a global fetch compatibility wrapper.

The historical layout modules also still fetch `/api/graph`; do not individually paper over those reads. M4-F removes their private graph caches and gives layout stages Store-backed prepare state.

## 10. Person pane / metadata

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

## 11. Media / faces

D1 stores metadata; originals live in R2. Media is associated with people.
Preferred face is `metadata.primaryFaceId`; it must belong to the person or deterministic fallback applies.
Structural graph replacement prunes `media_people` associations for deleted people on the server. Do not orphan media-person links.

Graph-card face decoration now uses committed render lifecycle instead of observing graph card child-list changes. Modal-local observers for face editor state are legitimate UI-local observers and may remain.

## 12. Layout compatibility stack / M4-F target

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

M4-F must convert these to direct `FamilyRenderController` stage registration and Store-backed prepare state, then delete:

```text
captureLegacyModule
setLayout / setLoadTree
function-name waitFor polling
sentinel scripts
legacy-symbols.js
layout/loadTree monkey patches
private /api/graph caches in layout modules
```

Preserve algorithm behavior while flattening ownership:

- parent-pair/union semantics;
- multi-partner components;
- distinct child groups for different unions;
- lineage-aware member order;
- sibling/union contiguity;
- final planar connector routing.

Do not combine M4-F ownership cleanup with algorithm redesign.

## 13. M4-G deletion pass

After M4-F stabilizes:

- remove own-graph-DOM MutationObservers; keep only genuinely UI-local/external observers;
- delete remaining history/save compatibility wrappers;
- remove `family-graph-render-stable` after its final listener migrates;
- consolidate/delete print polish/refinement overlap;
- remove milestone/slice comments and naming debt when touching their owners;
- delete low-value source-string tests when equivalent behavioral/ownership tests exist.

## 14. Tests / diagnostics

`npm test` includes behavioral/ownership tests for:

- topology invariants;
- FamilyApi transport/fallback/mutation events;
- GraphStore;
- selection;
- visual roles;
- placeholder classification;
- FamilyMutations;
- runtime shell/ownership conformance;
- RenderController generations.

Diagnostics of interest:

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
