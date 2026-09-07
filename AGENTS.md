# AGENTS.md — family_tree continuity guide

This file is the authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Read it before changing the repository. Update it whenever architecture or invariants materially change.

## 1. Working style / repo rules

- Work directly on `main` unless the user explicitly asks for a PR.
- **Do not create PRs by default.**
- Refetch the current file SHA before every GitHub write; never reuse stale SHAs.
- Never claim a commit/test/deploy unless it actually succeeded.
- Prefer implementation over speculative design when the user says “do it”.
- Do not deploy from the assistant unless explicitly asked and the environment supports it.
- Normal user flow:

  ```bash
  git pull
  npm test
  ./deploy.sh
  ```

- Production: `family.barnahum.com`.
- Stack: Cloudflare Worker + D1 + R2 + static frontend.

## 2. Product model

The app is one **global person-centric family graph**, not saved trees/views.

```text
People ←→ Relationships
```

A visible tree is ephemeral:

```text
selected person
+ canonical graph
+ projection rules
→ visible subgraph
→ one RenderController generation
```

Selecting another person reroots the projection around that person.

### Selection / root persistence

- URL `?person=` is an explicit selection source.
- LocalStorage key: `family-tree.anchor-person`.
- `public/selection-controller.js` is the canonical browser owner of URL + LocalStorage selection persistence/events.
- `public/graph-view.js` owns the internal projection root (`graphRootId`) and reroot mechanics.
- Side/collateral expansions are ephemeral and clear on reroot.
- Do not create another selection persistence owner.

## 3. Canonical graph invariants

Physical `nodes` still includes legacy `parent_id` / `spouse_id`, but canonical topology is in `relationships`.

```text
nodes
  id
  name
  metadata_json
  parent_id   // legacy physical column; not canonical topology
  spouse_id   // legacy physical column; not canonical topology
  last_updated

relationships
  id
  type        // parent | spouse
  person1_id
  person2_id
  created_at
```

Treat `spouse` as a partner/family **union** topology edge; do not over-interpret legal marital status.

### Parent limit / parent-union rule

A person may have at most two explicit canonical parents.

```text
0 parents       valid
1 parent        valid
2 parents       valid only as a clean parental union
>2 parents      reject
```

If a child has exactly two explicit parents but the parent union is missing, normalize by adding the spouse/union edge.

### Multi-spouse child creation

```text
0 spouses  → generic +child creates sole-parent child
1 spouse   → generic +child creates child with both explicit parents
2+ spouses → generic +child must not execute
```

With 2+ spouses, child creation is union-specific. Never guess the co-parent.

### Adding a second parent

If a child has one explicit parent and another is added, atomically ensure:

```text
parent2 → child
parent1 ↔ parent2
```

Frontend expresses intent; backend/graph normalization owns the invariant.

## 4. Names / identity / pickers

Canonical normalization:

```js
String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')
```

Use it on save/import/backend normalization and collision/search identity. Do not remove all internal spaces.

`public/person-identity.js` is the shared identity/disambiguation owner. It consumes `FamilyGraphStore` and its shared topology indexes.
Unique names remain visually unchanged. Collision qualifiers prefer the shortest useful gender-neutral Hebrew cue:

1. parent identity
2. child identity
3. spouse identity
4. life dates
5. place
6. combine only if still ambiguous
7. internal ID only as pathological fallback

All person pickers/searches should consume the same identity presentation. `public/person-picker-refresh.js` reads the current GraphStore document and listens to explicit store/identity events.

## 5. Person pane / metadata

Cards are topology-focused: name, structural actions, delete, portrait. Biography lives in the selected-person pane.

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

Dates are free text. Places may preserve human text plus GeoNames data.
Do not revive old `dates` / `description` migration behavior.

### Save behavior

- Unchanged pane fields are true no-ops: no PATCH / revision bump.
- Unchanged card-name blur is also a no-op.
- Successful pane edits update visible/in-memory state and GraphStore directly when the exact delta is known; do not force a topology redraw.

## 6. New-person UX

After creating a child/person:

- reroot/select appropriately;
- focus the right-pane name editor;
- keyboard focus ready for typing;
- on mobile open pane/sheet as needed.

Relevant helper: `public/new-person-focus.js`.

Completely blank placeholder deletion requires no confirmation. Populated people / meaningful data/media remain protected.

## 7. Projection / visual roles

Projection lives in `public/graph-view.js`.

Default intent:

- selected ancestry: eager recursive
- selected descendants: eager recursive
- selected spouse(s): visible
- spouse ancestry: limited by default
- selected person’s siblings: visible and **not gray**
- collateral branches: lazy behind +N
- reroot clears expansion state

`public/visual-roles.js` is the only refinement owner for root/context/spouse-ancestry dimming. It consumes GraphStore indexes and explicit selection/store/render events; it does **not** observe card DOM mutations.

Example: if Anat is selected and Guy has another spouse:

- Anat siblings remain primary;
- Guy remains primary as Anat’s spouse;
- Guy’s other spouse is contextual;
- descendants of Guy + that other spouse’s union are contextual.

Do not reintroduce independent gray-state computation elsewhere.

## 8. Media / faces

D1 stores media/face metadata; original image bytes live in R2.
Media is associated with people, not owned by one person.

Routes include:

```text
GET/POST      /api/media?person=ID
PATCH/DELETE  /api/media/:id
GET           /api/media/:id/content
```

R2 original key is deterministic: `media/{id}/original`.
Content reads should not unnecessarily depend on D1.

Faces:

```text
faces
  id
  media_id
  person_id nullable
  x y width height   // normalized 0..1
  created_at
  updated_at
```

Rules:

- many faces/photo
- assignment optional
- deleting face does not delete photo
- assigning face ensures media association
- preferred face is `metadata.primaryFaceId`
- preferred face must belong to person
- invalid/missing preferred face falls back deterministically

### Node portrait footprint

Portrait is centered on left card edge:

- normal 40 px diameter → `left: -20px`
- root 44 px diameter → `left: -22px`

Layout must reserve the outside half-diameter. Portrait changes should only reflow when footprint/set actually changes.

## 9. Canonical client graph store — M3

`public/graph-store.js` is the **single browser-side owner** of the canonical graph document and graph cache state.

It owns:

```text
graph document
revision
serverRevision
stale / dirty state
persistent LocalStorage snapshot
peopleById
parentsByChild
childrenByParent
spousesByPerson
```

Persistent key remains:

```text
family-tree.graph-cache.v1
```

There is no `FamilyGraphCache` compatibility API anymore.
The old files were deleted:

```text
public/graph-cache.js
public/graph-resilience.js
```

Clean graph reads stay in GraphStore. If stale/dirty, GraphStore performs one `/api/graph` network refresh and atomically replaces the document + indexes. Failed non-authoritative refreshes may use the last good stored graph; authoritative structural intent must fail rather than write from a stale fallback.

### GraphStore events

Use explicit events for cross-module graph lifecycle:

```text
family-graph-store-changed
family-graph-store-fetch
```

Do not revive `family-graph-fetch`.

The current captured legacy layout algorithms still call `fetch('/api/graph')`; GraphStore intercepts those GETs so they receive the same canonical document without creating another graph source. New application code should call `FamilyGraphStore` directly.

Important GraphStore consumers now include:

- `graph-sync.js`
- `visual-roles.js`
- `person-identity.js`
- `person-picker-refresh.js`
- `parent-limit.js`
- `union-child-actions.js`

## 10. Revision sync — M3

The old full-graph 5-second poll is removed. Stale detection uses singleton `graph_state` revision:

```text
GET /api/graph/revision
```

Policy:

```text
ACTIVE: visible + focused + activity <60s → every 5s
IDLE:   visible + focused + no activity 60s → every 15m
HIDDEN/BLURRED → no polling
focus/visible again → immediate check
```

Never overlap revision checks.

Reconciliation:

- coalesce remote changes;
- at most about one reconciliation per 30s during a burst;
- jump to latest revision;
- mark GraphStore stale for the target revision;
- run graph-view’s canonical `loadTree` path;
- graph-view/RenderController decide whether topology actually renders;
- metadata/media/face-only revisions should stay layout-inert where possible.

`public/graph-sync.js` no longer contains M1/M2 render-repair token machinery. The following are gone:

```text
__familyRevisionReconcileToken
__familyGraphMutationLayoutToken
settleRenderWindow
revision-layout suppression events
noop-resize suppression events
```

Structural mutations mark GraphStore dirty. Known pane deltas can be folded directly into Store at the returned revision without a full graph refresh.

## 11. Render architecture — M2 retained through M3

`public/render-controller.js` is the sole active owner of global `layoutAndRender`.

Active pipeline:

```text
projection/cards
→ base-geometry
→ relationship-compaction
→ planar
→ member-order       // explicit feedback owner of planar prefix
→ bridge-compaction
→ planar-router      // one final connector generation
→ assert
→ visual roles / union controls
→ center root OR restore anchor
→ committed generation event
```

Prepare hooks refresh algorithm-local relationship indexes before structural renders:

```text
multi-partner
planar
member-order
bridge-compaction
planar-router
```

Historical stage RAF paint callbacks are captured by RenderController and do not paint independently.
A newer pending generation supersedes an older pending generation by serial ID.

Do not fix render bugs by adding another RAF/timer/observer/wrapper. Find which projection, prepare hook, stage, or final commit violated the generation contract.

### Centering invariant

Never center while geometry is changing.
The root is centered only in the controller’s final commit after card coordinates + connectors are authoritative.
Non-reroot layout requests preserve the selected-root screen anchor unless a caller intentionally centers later.

### Compatibility render event

`family-graph-render-stable` is still emitted after the authoritative controller commit for feature compatibility. It no longer represents a separate stabilization layer.
Prefer `family-graph-rendered` for new code.

## 12. Runtime/bootstrap architecture — M3

### Server asset path

`src/entry.js` now directly owns frontend asset serving/injection. Production frontend requests no longer pass through `src/worker.js`’s historical HTML script-injection path and then get rewritten again.

`entry.js` strips only the two legacy inline startup behaviors that still live in `public/index.html`:

- old full-tree 5-second poll;
- legacy initial `loadTree(null, true)`.

Then it injects one deterministic foundation:

```text
graph-store.js
graph-status.js
person-identity.js
person-picker-labels.js
media-resilience.js
graph-view.js
runtime-bootstrap.js
```

API requests still route through entry/worker API handlers as appropriate.

### `runtime-bootstrap.js`

Startup:

1. load `selection-controller.js`;
2. load `render-controller.js`;
3. restore selected person;
4. load import/export + interaction + node-hover + mobile/presentation/features;
5. capture existing layout algorithms as named RenderController stages;
6. install visual roles;
7. call `startFamilyGraph()` only after the final render pipeline exists;
8. await first committed graph render;
9. restore graph-view’s canonical loader and install graph-sync/debug;
10. emit `family-runtime-ready` with selection + GraphStore + RenderController snapshots.

`node-hover.js` no longer bootstraps scripts; runtime-bootstrap loads it explicitly.

## 13. Explicit lifecycle vs MutationObserver — M3

M3 removed DOM-mutation communication where canonical lifecycle events already exist.

Now explicit:

- visual roles → selection/store/render events
- parent limit → store/render events
- union child controls → store/render events + RenderController explicit refresh
- identity/pickers → store/identity events

Do **not** use MutationObserver as a module message bus.

Some observers intentionally remain when they are actually watching UI/DOM state that has no canonical domain event yet, for example face-editor select contents, external/late DOM insertion, or footprint/decorative UI changes. Keep those local and narrowly scoped.

## 14. Deleted M1/M2 repair remnants — M3

These files are physically deleted and must not be referenced again:

```text
public/revision-layout-guard.js
public/graph-render-stability.js
public/root-selection-coherence.js
public/root-context-refinement.js
public/graph-cache.js
public/graph-resilience.js
```

Do not recreate them under new names.

Historical layout algorithm files still contain wrapper-installation code internally because runtime-bootstrap captures their proven implementations without rewriting geometry. After capture, global ownership immediately returns to RenderController. This is intentional until/unless the algorithms themselves are rewritten.

## 15. Layout algorithms / invariants

Core primitives still live in `public/index.html`.
Algorithm implementations remain in:

- `public/layout-refinement.js`
- `public/multi-partner-refinement.js`
- `public/planar-layout.js`
- `public/member-order-refinement.js`
- `public/bridge-compaction.js`
- `public/planar-router.js`

Semantic topology outranks visual scoring:

- children belong to explicit parent pairs/unions;
- multi-partner components can contain 3+ people;
- child groups for different unions remain separable;
- lineage-aware member order can outrank alternating spouse order;
- sibling/union blocks remain contiguous when required;
- bridge compaction only translates graph-safe self-contained branches;
- router avoids/reports connector crossings and card intersections;
- ordinary one-partner case must not regress.

Diagnostics retained:

```js
window.__familyLayoutDiagnostics
window.__familyMemberOrderDiagnostics
window.__familyBridgeDiagnostics
window.__familyRouteDiagnostics
window.__familyRenderControllerDiagnostics
window.__familyGraphStoreDiagnostics
window.__familyRuntimeBootstrapDiagnostics
window.__familySelectionDiagnostics
window.__familyVisualRoleDiagnostics
```

## 16. Historical render failure pattern

Previous failures included missing nodes, stale connectors, shifted cards, and malformed multi-partner geometry because:

1. graph-view replaced cards;
2. topology wrappers refreshed at different times;
3. old RAF callbacks survived from previous root/generation;
4. duplicate-layout guards could suppress a later corrective pass;
5. SVG and cards came from different generations.

M2/M3 solve this through ownership:

```text
GraphStore owns canonical data
SelectionController owns selected person persistence
GraphView owns projection
RenderController owns render generation
VisualRoles owns root-relative emphasis
GraphSync owns revision policy
RuntimeBootstrap owns startup ordering
Entry owns frontend asset bootstrap
```

Preserve those boundaries.

## 17. Print / PDF

Print/PDF uses current visible projection, one-page Letter landscape.
Relevant:

- `public/print-refinement.js`
- `public/print-polish.js`

Refetch current code before print changes; print/avatar behavior has changed historically.

## 18. Places / GeoNames

Autocomplete remains conservative:

```text
min query length: 3
debounce: ~450ms
max results: 6
cache TTL: 30 days
```

Places preserve human text; selected suggestions may also store country code, GeoNames ID, lat/long.

## 19. Browser translation

No app localization infrastructure. Product remains Hebrew-first and relies on browser translation if desired.

```html
<html lang="he" dir="rtl">
```

## 20. Deployment

`deploy.sh` stamps build SHA/time and runs Wrangler.
Possible first-time setup:

```bash
npx wrangler r2 bucket create family-tree-media
npx wrangler secret put GEONAMES_USERNAME
```

## 21. Tests

`npm test` runs unit tests plus syntax checks.
High-value suites include:

- planar core
- person metadata / UI
- person identity
- graph invariants
- faces
- selection-controller
- **graph-store**
- visual-roles
- runtime-ownership
- render-controller

M3 tests should guard:

- clean GraphStore reads do not hit network;
- stale GraphStore performs one canonical network refresh;
- graph replacement rebuilds shared indexes atomically;
- known local person delta advances/cleans the Store at its returned revision;
- old graph cache/resilience files are absent;
- old M1 render/selection repair files are absent;
- active runtime code does not reference `FamilyGraphCache`;
- sync contains no retired render-token/settle machinery;
- visual roles/parent-limit/union controls do not use MutationObserver as graph lifecycle communication;
- entry directly owns frontend bootstrap;
- RenderController remains the sole render owner.

If adding a significant frontend module, syntax-check it. If adding an isolatable invariant, add a unit test.

## 22. High-value files before changes

### Canonical graph / sync

```text
public/graph-store.js
public/graph-sync.js
public/graph-view.js
src/entry.js
src/worker.js
```

### Runtime / render

```text
public/runtime-bootstrap.js
public/render-controller.js
public/selection-controller.js
public/visual-roles.js
public/index.html
public/layout-refinement.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
```

### Structural mutations / invariants

```text
src/graph-invariants.js
public/union-child-actions.js
public/parent-limit.js
```

### Identity / pickers

```text
public/person-identity.js
public/person-picker-labels.js
public/person-picker-refresh.js
public/face-tagging-ux.js
```

### Media / faces

```text
src/media.js
src/faces.js
public/person-media.js
public/face-tagging.js
public/face-tagging-ux.js
public/face-primary.js
public/node-face-decoration.js
public/node-face-footprint.js
public/media-resilience.js
```

## 23. Current priority / roadmap

M1, M2, and M3 architecture refactors are implemented on `main`.

```text
M1
A deterministic bootstrap
B canonical selection ownership
C unified visual roles

M2
D explicit RenderController
E named layout stages
F retire active duplicate-layout/render repair guards

M3
G canonical GraphStore + sync consolidation
H replace DOM-observer messaging where practical
I direct server/frontend bootstrap ownership
J delete dead cache/render/selection repair remnants
```

The user explicitly requested: **finish the refactor first, then do bugs.**

Next work is therefore bug validation/fixing against the M3 architecture. Do not reopen architecture ownership unless a bug demonstrates a real ownership flaw.

Recommended browser verification before/while bug triage:

1. initial load/restored root: same person selected, right pane correct, graph centered;
2. select a contextual gray person once: root + active immediately;
3. rapid reroot: final root is last selection, centered, connectors coherent;
4. add child / parent / spouse: one structural refresh/render, no missing cards/stale lines;
5. multi-partner: union-specific child controls and grouping intact;
6. right-pane metadata edit: no topology render;
7. right-pane name edit: store/search/pickers update immediately;
8. remote revision: policy remains 5s active / 15m idle / paused hidden, coalesced to latest;
9. offline/quota graph read: last good Store graph remains visible with status;
10. mobile selection/sheet behavior unchanged;
11. F1 shows one Store and one RenderController with coherent selected root/revision.

## 24. User preferences for interaction

- Answers should be concise and implementation-oriented.
- When architecture is agreed and the user says “do it”, implement rather than only propose.
- User values clean invariants and natural UI behavior over special-case patches.
- Avoid unnecessary backward compatibility when the user explicitly says legacy data can be discarded.
- Preserve Hebrew-first product and browser-translation decision.

---

If this file conflicts with current code, current code + the user’s latest explicit instruction wins. Update this document after resolving the discrepancy.
