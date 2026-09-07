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
→ one render generation
```

Selecting another person reroots the projection around that person.

### Selection / root persistence

- URL `?person=` is an explicit selection source.
- LocalStorage key: `family-tree.anchor-person`.
- `public/selection-controller.js` is the canonical browser owner of URL + LocalStorage selection persistence/events.
- `graph-view.js` owns the internal projection root (`graphRootId`) and reroot mechanics.
- Side/collateral expansions are ephemeral and clear on reroot.
- Do not create another selection persistence owner.

## 3. Canonical graph invariants

### People

Physical `nodes` still includes legacy `parent_id` / `spouse_id`, but canonical topology is in `relationships`.

```text
nodes
  id
  name
  metadata_json
  parent_id   // legacy physical column; not canonical topology
  spouse_id   // legacy physical column; not canonical topology
  last_updated
```

### Relationships

```text
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
0 spouses → generic +child creates sole-parent child
1 spouse  → generic +child creates child with both explicit parents
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

Shared disambiguation lives in `public/person-identity.js` / picker helpers. Unique names stay visually unchanged. Collision qualifiers should be the shortest useful gender-neutral Hebrew cue, roughly:

1. parent identity
2. child identity
3. spouse identity
4. life dates
5. place
6. combine only if still ambiguous
7. internal ID only as pathological fallback

All person pickers/searches should consume the same identity presentation. After add/rename, refresh picker data from the canonical graph cache immediately.

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
- Successful pane edits should update in-memory/cache data directly when safe instead of forcing a topology redraw.

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

### Root-relative dimming

`public/visual-roles.js` is the single refinement owner for root/context/spouse-ancestry dimming classes.

Example: if Anat is selected and Guy has another spouse:

- Anat siblings remain primary.
- Guy remains primary as Anat’s spouse.
- Guy’s other spouse is contextual.
- descendants of Guy + that other spouse’s union are contextual.

Do not reintroduce independent gray-state computation into interaction, pane, or hover code.

`root-context-refinement.js` remains in the repository only as historical/dead compatibility code and is not loaded by the current runtime.

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

## 9. D1 revision sync / cache

The old full-graph 5-second poll is removed. Current stale detection uses singleton `graph_state` revision and:

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
- metadata/media/face-only revisions should stay layout-inert where possible.

`public/graph-cache.js` is a normal local source, not outage-only.

### M2 sync relationship

`graph-sync.js` is installed only **after the first RenderController commit**. It captures graph-view’s direct canonical `loadTree`; there is no active layout `loadTree` wrapper chain in M2.

Some old revision/mutation token bookkeeping still exists inside `graph-sync.js` for compatibility/metrics, but the old layout guard that consumed those tokens is not loaded. Removing that inert bookkeeping belongs to M3 sync/store cleanup, not render ownership.

### Debug tray

F1 (`Ctrl+Shift+D` fallback) shows sync/cache plus M2 RenderController metrics:

- committed/superseded generations
- pending/running stage
- named stage order/durations
- prepare stage order/durations
- final connector run count

## 10. Runtime/bootstrap architecture — M2

M1 established deterministic startup, canonical selection, and unified visual roles.
M2 (2026-09-07) replaces the active render-wrapper architecture with one explicit controller.

### Server response startup

`src/entry.js` transforms the historical HTML so:

- old 5-second full-tree poll does not run;
- legacy initial `loadTree(null, true)` does not run;
- worker-injected early `import-export.js` is removed;
- worker-injected early `layout-refinement.js` is removed;
- any stale `revision-layout-guard.js` tag is removed;
- graph cache/status/resilience, identity helpers, and media resilience load before graph-view;
- graph-sync/debug do not load early;
- `runtime-bootstrap.js` is the single late orchestrator.

`src/worker.js` still lists some historical refinement script names; do not treat that as active runtime ownership. `src/entry.js` strips them. Server/asset cleanup is M3.

### `runtime-bootstrap.js`

Startup now:

1. loads `selection-controller.js`;
2. loads `render-controller.js`;
3. restores selected person;
4. installs feature/UI modules;
5. captures existing layout algorithms as named stages;
6. installs `visual-roles.js`;
7. calls `startFamilyGraph()` exactly after the final controller pipeline exists;
8. waits for that initial committed render;
9. installs graph-sync/debug;
10. emits `family-runtime-ready`.

### Algorithm capture strategy

M2 intentionally does **not** rewrite proven geometry algorithms.
The historical modules are loaded in a controlled capture harness so their wrapper functions become stage implementations while global ownership returns immediately to RenderController.

Active named layout pipeline:

```text
base-geometry
  measure cards
  build family units
  assign generations
  base unit layout
  vertical placement
  member placement

→ relationship-compaction
→ planar
→ member-order       // feedback owner; explicitly reruns planar prefix when needed
→ bridge-compaction
→ planar-router      // final connector generation, not a layout wrapper
→ assert / roles / union controls
→ center root OR restore anchor
→ reveal/commit event
```

Prepare hooks refresh algorithm-local relationship indexes before structural renders:

```text
multi-partner
planar
member-order
bridge-compaction
planar-router
```

Prepare-hook calls to legacy `layoutAndRender()` are suppressed by the controller during prepare; they cannot start competing renders.

### RenderController contract

`public/render-controller.js` is the sole active owner of global `layoutAndRender`.

For a projected generation:

```text
cards/projection replaced synchronously
→ RenderController schedules one generation
→ named geometry stages run
→ historical stage RAF paint callbacks are captured, not allowed to paint
→ planar diagnostics may run without painting
→ exactly one final router connector generation
→ assert
→ apply visual roles / union controls
→ center or restore anchor
→ emit committed generation
```

A newer pending generation cancels/supersedes the previous pending generation by serial ID.
Do not reintroduce “drain stale RAFs” logic; old stage RAF paint callbacks are captured inside the controller instead.

Compatibility event `family-graph-render-stable` is still emitted by the controller after the authoritative commit so feature modules need not all change at once. It no longer means a separate stabilization layer ran.

Diagnostics:

```js
window.__familyRuntimeBootstrapDiagnostics
window.__familySelectionDiagnostics
window.__familyVisualRoleDiagnostics
window.__familyRenderControllerDiagnostics
window.FamilyRenderController
```

## 11. Retired M1 render repair layers

These files remain in the repository but are **not loaded by the M2 runtime**:

- `public/revision-layout-guard.js`
- `public/graph-render-stability.js`
- `public/root-selection-coherence.js`
- `public/root-context-refinement.js`

Do not add new dependencies on them. M3 can delete dead remnants after deployed equivalence is confirmed.

Likewise, historical layout modules still contain their old wrapper installation code because M2 captures those functions rather than rewriting algorithms. The global wrapper chain is not active after bootstrap.

## 12. Layout invariants / algorithms

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
```

### Centering invariant

Never center while geometry is changing.
A projected root is centered only in the controller’s final commit after card coordinates + final connectors are authoritative.
Non-reroot layout requests preserve the selected-root screen anchor unless a caller intentionally centers later (for example mobile presentation behavior).

## 13. Historical render failure pattern

Previous failures included missing nodes, stale connectors, shifted cards, and malformed multi-partner geometry because:

1. graph-view replaced cards;
2. topology wrappers refreshed at different times;
3. old RAF callbacks survived from previous root/generation;
4. duplicate-layout guards could suppress the later corrective pass;
5. SVG and cards came from different generations.

M2 solves this by ownership, not by adding redraws.
Do not fix future render bugs by stacking another RAF/timer/observer/wrapper. Diagnose which controller stage or prepare hook violated the generation contract.

## 14. Print / PDF

Print/PDF uses current visible projection, one-page Letter landscape.
Relevant:

- `public/print-refinement.js`
- `public/print-polish.js`

Refetch current code before print changes; print/avatar behavior has changed historically.

## 15. Places / GeoNames

Autocomplete remains conservative:

```text
min query length: 3
debounce: ~450ms
max results: 6
cache TTL: 30 days
```

Places preserve human text; selected suggestions may also store country code, GeoNames ID, lat/long.

## 16. Browser translation

No app localization infrastructure. Product remains Hebrew-first and relies on browser translation if desired.

```html
<html lang="he" dir="rtl">
```

## 17. Deployment

`deploy.sh` stamps build SHA/time and runs Wrangler.
Possible first-time setup:

```bash
npx wrangler r2 bucket create family-tree-media
npx wrangler secret put GEONAMES_USERNAME
```

## 18. Tests

`npm test` runs unit tests plus syntax checks.
High-value suites now include:

- planar core
- person metadata / UI
- person identity
- graph invariants
- faces
- selection-controller
- visual-roles
- runtime-ownership
- **render-controller**

M2 tests guard:

- bootstrap loads RenderController and named stages before graph start;
- M1 revision/render stability repair layers are not loaded;
- graph-view delegates structural prepare + projection commit to RenderController;
- a newer pending projection supersedes the older generation;
- named stage feedback executes through the explicit planar prefix;
- exactly one final connector generation/assert occurs in the controller harness;
- committed render events/diagnostics describe the authoritative generation.

If adding a significant frontend module, syntax-check it. If adding an isolatable invariant, add a unit test.

## 19. High-value files before changes

### Runtime/render

```text
src/entry.js
public/runtime-bootstrap.js
public/render-controller.js
public/selection-controller.js
public/graph-view.js
public/visual-roles.js
public/graph-sync.js
public/graph-debug.js
public/index.html
public/layout-refinement.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
```

### Presentation/geometry requesters

```text
public/person-pane.js
public/presentation-refinement.js
public/mobile-refinement.js
public/node-face-footprint.js
public/slice-a-polish.js
public/slice-a-geometry.js
public/union-child-actions.js
```

These modules may still call global `layoutAndRender()`; under M2 that call is a request to RenderController, not ownership of a wrapper chain.

### Mutations/invariants

```text
src/worker.js
src/graph-invariants.js
public/union-child-actions.js
public/parent-limit.js
```

### Identity/search

```text
public/person-identity.js
public/person-picker-labels.js
public/person-picker-refresh.js
public/face-tagging-ux.js
```

### Media/faces

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

## 20. Roadmap / next work

M1 and M2 are implemented on `main` but require normal local/browser validation before declaring deployed equivalence.

```text
M1
A deterministic bootstrap
B canonical selection ownership
C unified visual roles

M2
D explicit RenderController
E named-stage layout pipeline
F active revision/render repair guards retired

M3 next
G graph store/sync consolidation (one canonical client graph document/index source)
H replace internal MutationObserver communication with explicit events where practical
I server/asset bootstrap cleanup (stop worker from adding scripts that entry later strips)
J delete dead M1 wrappers/tokens/remnants after deployed equivalence
```

### M2 browser verification

After deployment verify at least:

1. Initial/restored root: same selected person, pane correct, centered.
2. Select gray contextual person once: immediately root + fully active.
3. Rapidly select several people: only final root remains visible/centered; connectors coherent.
4. Add child/parent/spouse: no missing cards/stale lines; one final render generation.
5. Multi-partner families: union-specific children and routing unchanged.
6. Expand/collapse collateral branches: anchor preserved, no duplicate connector generation.
7. Right-pane/name/portrait footprint reflow: controller owns the request and preserves anchor.
8. Remote revision: controller commit completes before `family-graph-synced` settles; metadata-only revision stays layout-inert.
9. Mobile selection/sheet/centering behavior unchanged.
10. F1: `Render generations` increments once per committed visible generation; `Final connector runs` tracks commits; no M1 “suppressed layout” transaction is required.

## 21. User preferences

- Concise, implementation-oriented communication.
- When architecture is agreed and user says “do it”, implement.
- Prefer clean invariants/natural behavior over special-case patches.
- Avoid unnecessary legacy compatibility when user has accepted removal.
- Preserve Hebrew-first + browser-translation decision.

---

If this guide conflicts with current code, current code + the user’s latest explicit instruction wins. Update this guide after resolving the discrepancy.
