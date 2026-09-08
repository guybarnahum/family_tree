# AGENTS.md — family_tree continuity guide

Authoritative handoff for `guybarnahum/family_tree`. Current code and explicit user instructions override historical notes.

## Repo rules

- Work directly on `main`; no PR unless explicitly requested.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy passed unless actually observed.
- Fix defects at the owning abstraction/source of truth. Never cover an upstream defect with downstream repair code.
- When proper ownership replaces a wrapper, observer, timer, fallback, cache or compatibility shim, delete the superseded code.
- Code and tests must justify existence by protecting observable behavior, a durable product/data invariant, or a necessary platform boundary.
- Prefer behavioral tests. Do not freeze implementation shape with source-string tests.
- Name modules by runtime ownership, not planning milestones.

User validation:

```bash
git pull
npm test
./deploy.sh
```

Production: `family.barnahum.com`. Stack: Cloudflare Worker + D1 + R2 + static frontend.

## Product invariants

One canonical global graph:

```text
People ↔ Relationships
```

The visible tree is an ephemeral projection around the selected person.

- at most two explicit parents;
- exactly two explicit parents must form a union;
- 0 spouses → generic +child has one explicit parent;
- 1 spouse → generic +child has both explicit parents;
- 2+ spouses → generic +child is ambiguous; use union-specific child action;
- never guess a co-parent;
- adding a second parent ensures the parent union;
- names are NFC + trimmed + repeated whitespace collapsed;
- selected person's siblings are never dimmed;
- spouse's other union/subtree may be contextual;
- portraits sit on the card's left edge and reserve their outside half-radius.

## Runtime ownership

```text
SelectionController
        ↓
   GraphStore ← FamilyApi
        ↓
     GraphView
        ↓
 RenderController
        ↓
 layout stages → planar-router → validation
        ↓
    DOM + viewport
```

### SelectionController

`public/selection-controller.js` owns selected ID, `?person=`, localStorage and selection events. It does **not** monkey-patch `history.replaceState`/`pushState`; repo code changes selection through its API. `popstate` is consumed normally.

Invariant:

```text
SelectionController ID
=== GraphView projection root
=== RenderController rootId
=== exactly one DOM .graph-root
```

### GraphStore / sync

`public/graph-store.js` owns canonical browser graph state, revision/staleness and shared indexes:

```text
peopleById
parentsByChild
childrenByParent
spousesByPerson
```

Persistent snapshot key: `family-tree.graph-cache.v1`.
`public/graph-sync.js` owns revision polling. Neither Store nor Sync wraps fetch.

### FamilyApi

`public/family-api.js` is the browser application transport owner. It owns request/json helpers, revision headers, mutation events and resilient media/face catalog reads. It captures native fetch once but never assigns `window.fetch`.

GraphView reads canonical graph only through Store. Feature APIs use FamilyApi explicitly.

### FamilyMutations

`public/family-mutations.js` owns person/topology writes:

```js
updatePerson
addChild
addChildToUnion
addParent
addSpouse
deletePerson
putGraph
```

Structural edits start from an authoritative Store refresh, use one transactional `PUT /api/graph`, then one canonical refresh. Person edits use `PATCH /api/nodes/:id`. Unchanged edits are no-ops.

`union-child-actions.js` is presentation only. `person-pane-editing.js` delegates saves to FamilyMutations.

## Shell / foundations

`public/index.html` is a shell only. `src/entry.js` injects foundations in this order:

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

`public/family-core.js` contains foundational card/layout primitives only; it must not own graph loading, polling, selection or mutations.

Deleted compatibility files include:

```text
legacy-symbols.js
pane-save-guard.js
media-resilience.js
graph-cache.js
graph-resilience.js
revision-layout-guard.js
graph-render-stability.js
root-context-refinement.js
root-selection-coherence.js
```

## Projection / visual roles

`public/graph-view.js` owns root-relative projection semantics:

```text
root / primary / sibling / context
```

Selected siblings are emitted as `viewRole: "sibling"`; VisualRoles consumes that committed semantic role and must not reconstruct siblinghood from layout fields.

Historical placeholder bug: `node-hover.js` intentionally uses `textContent` after `family-graph-rendered`; do not replace it with layout-sensitive `innerText` while the canvas is hidden.

## Render / layout

`public/render-controller.js` owns one coherent generation:

```text
projection/cards
→ base geometry
→ relationship-compaction
→ planar
→ member-order feedback
→ bridge-compaction
→ planar-router
→ base assertion
→ planar validation
→ commit one DOM root
→ visual roles / union controls
→ one center OR anchor restore
→ family-graph-rendered
```

There is no legacy `layoutAndRender`/`restoreAnchor` facade and no `family-graph-render-stable` compatibility event.

Registered layout modules:

```text
multi-partner-refinement   prepare:10 + family-unit/union primitives
layout-refinement          layout:20
planar-layout              prepare/layout:30 + validate:30
member-order-refinement    prepare/layout:40, ownsPrefix
bridge-compaction          prepare/layout:50
planar-router              prepare:60 + final connector owner
```

M4-F removed function capture, load/layout monkey patches, function-name polling, captured RAFs, dummy sentinels and private layout graph fetches. Member-order feedback explicitly calls `FamilyRenderController.runThrough('planar')`.

Feature geometry changes use `requestLayout(...)`, `requestGeometryRefresh(...)` or `requestRecenter(...)`. Never add corrective RAF/timer/observer centering passes.

## Person pane / mobile

`person-pane.js` gets selection from SelectionController and people from GraphStore. Its former private root resolver, history wrappers, graph DOM observers and corrective relayout/centering system are deleted.

Cards are read-only; editing lives in the pane. Metadata edits should not redraw topology. Name edits may request one geometry refresh because width can change.

`mobile-refinement.js` owns only responsive CSS and generation/mobile spacing primitives. It does not load other modules, draw connectors, reroot, or perform startup/corrective centering. Bootstrap explicitly loads mobile → presentation → multi-partner in that order.

## Media / faces

D1 stores metadata; originals live in R2. Preferred face is `metadata.primaryFaceId` and must belong to that person or deterministic fallback applies.

Graph-card face decoration uses committed render lifecycle. Portrait footprint measurement also uses explicit render/face events; graph-card MutationObservers are not needed.

Modal-local observers are legitimate when they observe local UI state.

## Current deletion work / M4-G

Deletion-first rule: do not pursue a metric like “zero observers”; remove code only when another owner already provides the needed lifecycle/state.

Completed in the current M4-G pass:

- deleted runtime source-string conformance/ownership tests;
- merged duplicate metadata helper tests;
- removed interaction graph-card observer and duplicate stable-event listener;
- removed dead parent mutation wrapper/polling from parent-limit;
- removed graph-card observer from portrait footprint;
- removed person-pane history/observer/relayout/centering subsystem;
- removed mobile self-bootstrap/router/centering subsystem;
- removed RenderController compatibility facade and stable event;
- removed SelectionController history monkey-patching.

Remaining candidates require behavior-preserving replacement, not blind deletion:

- old unused renderer primitives still present in `family-core.js` / multi-partner connector code;
- `print-polish.js` should be folded into the print builder, then deleted;
- `person-pane-position.js` still protects visible desktop title/pane alignment; replace its repair timers/observer only with a cleaner equivalent;
- review UI-local observers individually;
- remove stale milestone comments when touching their owners.

Do not redesign the proven layout algorithms during cleanup.

## Tests

`npm test` keeps behavioral/invariant tests plus cheap syntax checks. High-value coverage includes:

- topology/parent-union invariants;
- metadata and person identity;
- face normalization/preference;
- selection behavior;
- FamilyApi transport/fallback/mutation events;
- GraphStore;
- visual roles/sibling protection;
- real-name placeholder regression;
- FamilyMutations;
- RenderController generation/stage/connector/validation behavior.

Diagnostics of interest:

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
