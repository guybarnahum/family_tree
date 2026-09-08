# AGENTS.md — family_tree continuity guide

Authoritative handoff for `guybarnahum/family_tree`. Current code and explicit user instructions override historical notes.

## Repo rules

- Work directly on `main`; no PR unless explicitly requested.
- Refetch the current file SHA before every GitHub write.
- Never claim tests/deploy passed unless actually observed.
- Fix defects at the owning abstraction. Do not add downstream repair layers.
- When an owner replaces a wrapper, observer, timer, fallback, cache or compatibility shim, delete the superseded code.
- Code and tests must justify existence by protecting observable behavior, a durable invariant, or a necessary platform boundary.
- Prefer behavioral tests; do not freeze implementation shape with source-string tests.

User validation:

```bash
git pull
npm test
./deploy.sh
```

Production: `family.barnahum.com`. Stack: Cloudflare Worker + D1 + R2 + static frontend.

## M4 status

M4 is in its final cleanup phase:

```text
M4-A  one selection authority             done
M4-B  one render + viewport authority     done
M4-C  explicit mutation layer             done
M4-D  shell-only index                    done
M4-E  one transport/data path             done
M4-F  direct registered layout pipeline   done
M4-G  compatibility/dead-code deletion    active, late stage
```

M4-G is deletion-first: remove code only when observable behavior already has a clear owner. Do not recreate compatibility wrappers while cleaning them up.

## Product invariants

One canonical graph:

```text
People ↔ Relationships
```

The visible tree is an ephemeral projection around the selected person.

- at most two explicit parents;
- exactly two explicit parents form a union;
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

`public/selection-controller.js` owns selected ID, `?person=`, localStorage and selection events. It does not monkey-patch browser history. Repo code changes selection through SelectionController; `popstate` is consumed normally.

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

Persistent snapshot: `family-tree.graph-cache.v1`.

`public/graph-sync.js` owns revision polling/coalescing and reconciles explicitly through:

```js
FamilyGraphView.refresh({ force: false, recenter: false })
```

There is no `loadTree` compatibility global and no `dataSignature` render-detection global.

### FamilyApi

`public/family-api.js` is the sole browser application transport owner. It owns request/json helpers, revision headers, mutation events and resilient media/face catalog reads. It never replaces `window.fetch`.

### FamilyMutations

`public/family-mutations.js` owns topology/person writes:

```js
updatePerson
addChild
addChildToUnion
addParent
addSpouse
deletePerson
putGraph
```

Structural edits start from authoritative Store state, use one transactional `PUT /api/graph`, then refresh through `FamilyGraphView.refresh({ force:true, recenter:false })`. Person edits use one `PATCH /api/nodes/:id`. Unchanged edits are no-ops.

New-person selection is one deterministic SelectionController call followed by a focus intent. `new-person-focus.js` waits for the matching committed render instead of polling animation frames.

## Shell / foundations

`public/index.html` is a shell only. `src/entry.js` injects:

```text
family-core
selection-controller
family-api
graph-store
graph-status
family-mutations
person-identity
graph-view
runtime-bootstrap
```

The fixed title/search shell is intentionally above the person pane in the stacking order so autocomplete results can overlap the pane and remain selectable. A child dropdown z-index cannot escape a lower parent stacking context; preserve the shell-level ordering.

`family-core.js` contains foundational card/geometry primitives only. It has no graph loading, polling, selection, mutations, old renderer entry point, old connector renderer, edit-state shim, or graph signature global.

Deleted compatibility/runtime-repair files include:

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
print-polish.js
parent-limit.js
interaction-refinement.js
person-picker-refresh.js
person-picker-labels.js
face-open-selection.js
graph-card-geometry.js
node-face-footprint.js
mobile-chrome.js
```

## Projection / visual roles

`public/graph-view.js` owns root-relative projection semantics (`root / primary / sibling / context`) and is the explicit graph refresh API.

`public/visual-roles.js` is commit-only. RenderController calls:

```js
FamilyVisualRoles.refreshNow(committedRootId)
```

exactly during the authoritative render commit. VisualRoles owns the visual styling for root/spouse-ancestry roles as well as assigning those classes. It has no root fallbacks, Store/pane/render listeners, queued reapplication, or duplicate root-context diagnostics.

Historical placeholder bug: `node-hover.js` intentionally classifies card text from `textContent` after `family-graph-rendered`; do not replace it with layout-sensitive `innerText` while the canvas is hidden.

## Render / layout

`public/render-controller.js` owns one coherent generation:

```text
projection/cards
→ portrait decoration + measurement outset
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

There is no legacy `layoutAndRender`/`restoreAnchor` facade and no `family-graph-render-stable` event.

Registered layout modules:

```text
multi-partner-refinement   prepare:10 + family-unit/union primitives
layout-refinement          layout:20
planar-layout              prepare/layout:30 + validate:30
member-order-refinement    prepare/layout:40, ownsPrefix
bridge-compaction          prepare/layout:50
planar-router              prepare:60 + final connector owner
```

Member-order feedback explicitly calls `FamilyRenderController.runThrough('planar')`. Never add corrective render/centering RAFs, timers or observers.

`family-core.js` now directly owns both responsive geometry dimensions:

```text
desktop horizontal unit gap  90
mobile horizontal unit gap   48
desktop generation gap       96
mobile generation gap        84
compact fallback band        56
mobile top padding           150
```

`graph-card-geometry.js` is deleted. `mobile-refinement.js` no longer replaces `assignVerticalPositions`, `unitSeparation`, or `simplePack`.

RenderController owns viewport commits. Mobile CSS must not apply `scroll-behavior:smooth` to `#scroll-viewport`; sequential `scrollLeft`/`scrollTop` writes must be immediate so a reroot is one deterministic center commit just like desktop.

`union-child-actions.js` is commit-only presentation. RenderController calls `FamilyUnionChildActions.refresh()` after final geometry; the module no longer listens to Store/render/pane/identity events or queues its own RAF pass.

## Person pane / mobile

`person-pane.js` gets selection from SelectionController and people from GraphStore. Its private root resolver, history wrappers, graph DOM observers and corrective relayout/centering system are deleted.

`person-pane-position.js` uses ResizeObserver + viewport/media-query lifecycle only; its old DOM mutation watcher and delayed 80/240 ms repair passes are deleted.

`person-pane-editing.js` owns pane editing presentation only; its old header-cleanup observer subsystem is deleted.

`place-autocomplete.js` consumes pane selection/render/save lifecycle directly for stored flags; its pane-body MutationObserver and RAF repair passes are deleted. Autocomplete debounce/focus timing remains local input behavior.

`person-media.js` consumes explicit selection/render/save lifecycle and calls `ensureSection()` synchronously. Its pane-body MutationObserver, RAF queue, unused cards-layer dependency and stale edit-state compatibility writes are deleted.

`mobile-refinement.js` is the single responsive/touch stylesheet owner. `mobile-chrome.js` is deleted; do not recreate a second late stylesheet whose purpose is to override the first one.

Selected-card height is content-driven. Old fixed/high-specificity mobile height/padding rules that made the root artificially tall are retired; presentation owns compact root padding. Do not reintroduce a fixed selected-card height or a competing root padding owner.

The obsolete `.graph-select-zone` presentation/print cleanup selectors are deleted; no runtime module creates that element.

## Media / faces / pickers

D1 stores metadata; originals live in R2. Preferred face is `metadata.primaryFaceId` and must belong to that person or deterministic fallback applies.

`face-tagging.js` owns face-editor people population from the current GraphStore, uses `FamilyPersonIdentity` for disambiguated select labels, and chooses the initial selected face itself (selected person's tagged face, otherwise the first face). The former `person-picker-refresh.js` and `face-open-selection.js` repair layers are deleted; there is no 90-frame polling or synthetic pointer selection.

`person-identity.js` owns canonical normalized/disambiguated labels. `graph-view.js` renders graph-search identity labels directly and `face-tagging-ux.js` renders face-search identity labels directly. `person-picker-labels.js`, its global input/focus listeners, queued decoration pass, disambiguation refresh listener, and DOM rewrite signatures are deleted.

`node-face-decoration.js` owns preferred graph-card portrait decoration and portrait measurement extension. Bootstrap awaits its initial preferred-face catalog before the first graph render. During base geometry RenderController calls decoration before `measureCards()`, then asks the face owner to extend measured width by the actual half-avatar outset. Later face-presence changes request geometry explicitly only when the visible set of portrait-bearing cards changes.

`node-face-footprint.js`, its `measureCards` monkey patch, avatar-signature RAF, and post-render corrective relayout are deleted.

`face-tagging-ux.js` and `face-primary.js` still contain modal-local observers. They are candidates for consolidation only if FaceTagging explicitly owns/publishes the corresponding editor state; do not replace them with another observer/event bridge.

## Print

`print-refinement.js` is the single print owner. It builds the clone, preserves measured card geometry, normalizes contextual presentation, preserves avatar crop, updates the family title from committed render/name-save events, and invokes the browser print boundary.

`print-polish.js` and its body MutationObserver are deleted. The remaining double-RAF before `window.print()` and Safari cleanup timer are browser/platform boundaries, not render-repair architecture.

## Deletion policy / remaining candidates

Deletion-first does not mean “zero observers.” Keep local observers when the browser/UI does not provide a better explicit lifecycle. Remove code only when another owner already provides the behavior.

High-value remaining candidates:

- consolidate FaceTagging/face UX state only where doing so deletes the remaining local observer bridges;
- remove stale planning comments while touching their owners.

Do not redesign the proven layout algorithms during cleanup.

## Tests

`npm test` runs behavioral/invariant suites plus syntax checks over `public/*.js` and `src/*.js`. High-value coverage includes topology/parent-union invariants, metadata/identity, faces, selection, FamilyApi, GraphStore, visual roles/sibling protection, placeholder classification, FamilyMutations, and RenderController generation/stage/router behavior.

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
