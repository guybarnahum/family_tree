# AGENTS.md — family_tree continuity guide

This file is the authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Read it before changing the repository. Update it whenever architecture or invariants materially change.

## 1. Working style / repo rules

- Work directly on `main` unless the user explicitly asks for a PR.
- **Do not create PRs by default.**
- Refetch the current file SHA before every GitHub write; never reuse stale SHAs.
- Never claim a commit unless the write actually succeeded and returned a commit SHA.
- Prefer direct implementation over speculative design when the user says “do it”.
- Do not deploy from the assistant unless explicitly asked and the environment actually supports it.
- Do not claim `npm test` passed unless it was really run.
- Normal user deploy flow:

  ```bash
  git pull
  npm test
  ./deploy.sh
  ```

- Current production site: `family.barnahum.com`.
- Stack: Cloudflare Worker + D1 + R2 + static frontend.

## 2. Product model

The app is a **single global person-centric family graph**, not a set of saved trees/views.

Canonical persistence:

```text
People ←→ Relationships
```

A visible tree is ephemeral:

```text
selected person
+ canonical graph
+ traversal / visibility rules
→ visible subgraph
→ generation-aware layout
```

There is no saved “view”. Selecting another person reroots the projection around that person.

### Root persistence

- URL `?person=` is an explicit selection source.
- LocalStorage key: `family-tree.anchor-person`.
- Current root persists across reloads.
- Side/collateral expansions are ephemeral and clear on reroot.
- As of M1 (2026-09-07), `public/selection-controller.js` is the canonical browser-side owner of URL/LocalStorage selection persistence and selection events.
- `graph-view.js` still owns the internal projection root (`graphRootId`) and reroot mechanics; history updates synchronously flow through the selection controller.
- `graph-render-stability.js` still contains some defensive root persistence while it remains as an M1 safety rail. Do not add another persistence owner; this duplication is intended to disappear when the stabilization wrapper is retired in M2.

## 3. Canonical graph invariants

### People

Person storage is effectively:

```text
nodes
  id
  name
  metadata_json
  parent_id   // legacy physical column; not canonical topology
  spouse_id   // legacy physical column; not canonical topology
  last_updated
```

Canonical topology lives in `relationships`.

### Relationships

```text
relationships
  id
  type        // parent | spouse
  person1_id
  person2_id
  created_at
```

`spouse` is topologically a family/partner **union** edge. Do not over-interpret it as current legal marital status.

### Parent limit

A person may have at most **two explicit canonical parent relationships**.

### Parent-union invariant

If a child has two parents, those two parents must be connected by the same union/spouse edge.

```text
0 parents       valid
1 parent        valid
2 parents       valid only as a clean parental union
>2 parents      reject
```

On graph writes/imports, if exactly two explicit parents exist but their union edge is missing, normalize by adding the spouse/union edge rather than leaving two disconnected parents.

### Multi-spouse child creation

A generic person-level `+ ילד` is only unambiguous when the person has 0 or 1 spouse.

```text
0 spouses → + child creates child with that person as sole parent
1 spouse  → + child creates child with both partners as explicit parents
2+ spouses → generic person-level + child must not execute
```

For 2+ spouses, child creation is **union-specific**: the user chooses the spouse/union and the child is created with both members of that union as explicit parents.
Never infer which spouse is the co-parent when multiple spouses are possible.

### Adding a second parent

If a child has one explicit parent and the user adds/selects a second parent, atomically ensure:

```text
parent2 → child
parent1 ↔ parent2
```

The frontend expresses intent; backend/graph normalization owns the invariant.

## 4. Person names and picker identity

Canonical name normalization everywhere:

```js
String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')
```

Use it on save/import/backend normalization and for name-collision/search/picker identity.
Do **not** remove all internal spaces.

### Duplicate names / disambiguation

Shared identity logic lives in `public/person-identity.js` and picker helpers.
Collision checks happen on normalized names.

Unique names stay visually unchanged. Collision groups use the shortest useful gender-neutral Hebrew qualifier, roughly:

1. parent identity: `הורה: X`
2. child identity: `הורה של Y`
3. spouse identity: `בן/בת זוג: Z`
4. life dates
5. place
6. combine qualifiers only if still ambiguous
7. internal ID only as pathological fallback

Do not add gender merely to solve Hebrew grammar.
Build the disambiguation index once per canonical graph state/revision, not independently in every picker.

All person pickers/searches consume the same derived identity presentation:

- global person search
- face assignment
- native hidden face select
- future parent/spouse/child/person reference pickers

After adding/renaming a person, refresh picker/autocomplete data from the current canonical graph cache immediately.

## 5. Person metadata / right pane

Graph cards are topology-focused:

- name
- add parent
- add spouse
- add child when unambiguous
- delete
- decorative face avatar

Biography lives in the selected-person pane on the right (desktop) / mobile sheet.

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

All optional. Dates are arbitrary text strings, not calendar-only values. Places may preserve human text plus structured GeoNames fields.
No separate View/Edit mode: inline editing in the same pane. Empty optional values stay visually quiet.

### Legacy metadata decision

Do **not** revive old `dates` or `description` migration behavior. The user explicitly accepted losing legacy values because there were effectively none.

### Save behavior

- Unchanged pane fields are true no-ops: no PATCH, no revision bump.
- Unchanged graph-card name blur is also a no-op.
- Successful pane edits update in-memory/cached canonical data directly when safe, avoiding redundant full graph fetch/redraw.

## 6. New-person UX

After creating a child/person through graph actions:

- select/reroot appropriately;
- focus the new person’s right-pane name editor;
- place keyboard focus ready for typing;
- on mobile, open the pane/sheet as needed.

Relevant helper: `public/new-person-focus.js`.

Deleting a completely unfilled placeholder person happens without confirmation. Populated people or people with meaningful data/media retain protective confirmation.

## 7. Projection semantics / visual emphasis

Core projection is in `public/graph-view.js`.

Default intent:

- selected/root ancestry: eager recursive
- selected/root descendants: eager recursive
- selected/root spouse(s): visible
- spouse ancestry: limited by default
- selected person’s own siblings: visible and **not gray**
- collateral branches: lazy behind +N controls
- reroot clears expansion state

### Root-relative context

Context dimming is relative to the selected person.
Example: if Anat is selected and Guy has another spouse:

- Anat’s siblings remain primary, not gray.
- Guy remains primary as Anat’s spouse.
- Guy’s **other spouse** is contextual/gray.
- Descendants belonging to Guy + that other spouse’s union are contextual/gray.

Do not gray all siblings or all spouse branches globally.

### M1 visual-role ownership

As of M1, `public/visual-roles.js` is the single refinement layer that converts canonical/root-relative graph context into dimming classes:

```text
graph-context
graph-spouse-parent
graph-spouse-ancestor-deep
```

It consumes `node.viewRole` from `graph-view.js` plus the cached canonical relationship graph. It guarantees the selected/root card cannot remain dimmed and promotes the selected root’s own siblings out of contextual gray.

`public/root-context-refinement.js` and `public/root-selection-coherence.js` remain in the repository for historical safety/reference and syntax checks, but **M1 runtime-bootstrap does not load them**. Do not re-add them to startup unless intentionally reverting the M1 ownership model.

`public/interaction-refinement.js` now owns pointer behavior + selection-footer presentation only. It must not fetch `/api/graph`, wrap History, compute visual roles, or request corrective layouts.

## 8. Media / R2

D1 schema includes `media` and `media_people`; original bytes live in R2.
Media is associated with people, not owned by one person.

Key routes include:

```text
GET/POST      /api/media?person=ID
PATCH/DELETE  /api/media/:id
GET           /api/media/:id/content
```

Uploads are capped at about 15 MB; supported image types include JPEG/PNG/WebP/GIF/AVIF.
R2 object key is deterministic (`media/{id}/original`), so content reads should not require D1 merely to discover the key.
Browser-side media resilience caches photo/face metadata so previously loaded media remains usable during D1 outages.

Limitation: a browser that never successfully loaded associations/crops cannot infer them from R2 bytes alone.

## 9. Faces / preferred portrait

Faces are separate records:

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

- many faces per photo
- face optionally assigned to person
- deleting face does not delete photo
- assigning a face to a person ensures media association
- preferred face lives at `metadata.primaryFaceId`
- preferred face must actually belong to that person
- invalid/missing preferred face falls back deterministically

Manual face tagging UX supports direct drag rectangles and searchable person assignment.

### Node portrait

The node portrait is a circular crop centered on the **left card edge**:

- normal 40 px diameter → `left: -20px`
- root 44 px diameter → `left: -22px`

Half the circle extends outside the card. Layout measurement reserves that outside half-diameter so neighboring nodes do not crowd the avatar.

Relevant files:

- `public/node-face-decoration.js`
- `public/node-face-footprint.js`

Portrait changes should not trigger unnecessary topology redraws; only reflow when the set/footprint of avatars actually changes.

## 10. D1 usage / graph caching / revision sync

The old app polled the **entire graph every 5 seconds**, and nested layout wrappers could multiply that into several full reads per tick. Current architecture uses a cheap singleton revision row.

### Revision table

Conceptually:

```sql
CREATE TABLE graph_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1
);
```

Cheap endpoint:

```text
GET /api/graph/revision
```

### Poll policy

```text
ACTIVE
visible + focused + user activity within 60s
→ revision check every 5s

IDLE
visible + focused + no activity for 60s
→ revision check every 15m

BLURRED / HIDDEN
→ no revision polling

focus / visible again
→ immediate revision check
```

Mouse/pointer movement counts as activity. Never overlap revision requests.

### Reconciliation rate limit

- coalesce remote revision changes;
- perform at most about one graph reconciliation/redraw per 30 seconds during a burst;
- jump directly to latest revision;
- a revision change does **not** imply a topology layout if only metadata/media/faces changed.

### Cache role

`public/graph-cache.js` is not outage-only; clean cached graph data is the normal local source.
Full `/api/graph` reads occur only when cache is missing, dirty, stale, or authoritative reconciliation is required.

### M1 sync startup

`public/graph-sync.js` keeps the same polling/reconciliation policy, but it no longer gets server-injected before the initial graph render.
`public/runtime-bootstrap.js` starts sync **after** the first graph has been rendered/settled so revision reconciliation cannot become a competing first renderer.

To preserve the existing efficient remote-reconcile behavior, runtime-bootstrap captures graph-view’s direct `loadTree` before layout wrappers, temporarily exposes that loader when graph-sync installs, then immediately restores the final authoritative wrapper. Graph-debug is loaded after graph-sync.

### Debug tray

F1 toggles the graph/debug tray (`Ctrl+Shift+D` fallback).
Relevant files:

- `public/graph-cache.js`
- `public/graph-resilience.js`
- `public/graph-sync.js`
- `public/graph-debug.js`
- `public/revision-layout-guard.js`

## 11. Runtime/bootstrap architecture — M1

M1 (2026-09-07) is a behavior-preserving runtime simplification. Domain rules, projection, layout algorithms, routing, sync frequencies, editing semantics, media/faces, and UI intent were not intentionally changed.

### Before M1

Startup effectively passed through multiple live architectures:

1. inline `index.html` legacy `/api/nodes` render;
2. Worker-injected graph/refinement scripts;
3. `node-hover.js` loaded 20+ more scripts;
4. `import-export.js → interaction-refinement.js → mobile-refinement.js` formed another loader chain;
5. layout/router wrappers installed asynchronously and were detected by polling function names;
6. sync could reconcile before the final render stack was ready.

That architecture produced timing races even when each individual refinement was locally correct.

### M1 current startup

`src/entry.js` now transforms the historical base HTML so:

- the old 5-second full-tree poll does not run;
- the legacy initial `loadTree(null, true)` does not run;
- worker-injected early `import-export.js` is removed;
- graph cache/status/resilience, revision guard and media resilience remain foundational pre-graph scripts;
- `graph-sync.js` / `graph-debug.js` are **not** injected early;
- `runtime-bootstrap.js` is appended as the single late runtime orchestrator.

`public/runtime-bootstrap.js` then:

1. installs `selection-controller.js` and restores URL/LocalStorage selection;
2. installs import/export, interaction, mobile/presentation/multi-partner and feature modules in explicit order;
3. installs planar core/layout → member order → bridge compaction → router;
4. waits for the existing revision-layout guard;
5. installs `graph-render-stability.js` as an M1 safety rail;
6. installs `visual-roles.js`;
7. **only then** calls `window.startFamilyGraph()`;
8. synchronizes the actual rendered root and applies roles;
9. after the initial graph settles, installs graph-sync and graph-debug;
10. emits `family-runtime-ready`.

Diagnostics:

```js
window.__familyRuntimeBootstrapDiagnostics
window.__familySelectionDiagnostics
window.__familyVisualRoleDiagnostics
window.__familyRootContextDiagnostics
```

### M1 ownership boundaries

- `node-hover.js`: card hover/default-placeholder polish only; no persistence, no runtime script loading.
- `import-export.js`: import/export UI/operations only; no History wrapping, root persistence, graph startup, or downstream script loading.
- `interaction-refinement.js`: pointer behavior + card center footer only; no graph fetch, History wrapping, visual-role computation, or corrective layout.
- `selection-controller.js`: canonical selection URL/LocalStorage/events.
- `visual-roles.js`: canonical refinement owner for root-relative dimming classes.
- `runtime-bootstrap.js`: startup sequencing.

Do not put those responsibilities back into feature modules.

### Temporary M1 compatibility

M1 deliberately keeps the current layout algorithms and stabilization guards. The following are still historical wrapper architecture and are targeted for M2, not to be casually removed during unrelated work:

- `revision-layout-guard.js`
- `graph-render-stability.js`
- progressive `layoutAndRender` wrappers
- function-name readiness checks inside the new bootstrap while those wrappers still initialize asynchronously
- some presentation/pane History wrappers that observe selection changes but should not own canonical selection persistence

## 12. Rendering/layout architecture — IMPORTANT

Core/base geometry still lives in `public/index.html`.
Person-centric projection is `public/graph-view.js`.
Topology/layout refinements still include:

- `public/layout-refinement.js`
- `public/multi-partner-refinement.js`
- `public/planar-layout.js`
- `public/member-order-refinement.js`
- `public/bridge-compaction.js`
- `public/planar-router.js`
- geometry/presentation helpers

Diagnostics include:

```js
window.__familyLayoutDiagnostics
window.__familyMemberOrderDiagnostics
window.__familyBridgeDiagnostics
window.__familyRouteDiagnostics
window.__familyRenderStabilityDiagnostics
```

### Historic failure pattern

A structural edit/reroot could produce missing nodes, stale connectors, shifted cards, or malformed multi-partner geometry because:

1. graph-view replaced cards / started a render;
2. topology-aware wrappers had not all refreshed indexes;
3. stale RAF callbacks from the prior graph/root remained queued;
4. duplicate-layout guards could suppress the later corrective pass;
5. SVG/card geometry could come from different render generations.

Do not “fix” this by adding another redraw, timer, observer, or wrapper.

### Current stabilization coordinator

`public/graph-render-stability.js` remains the M1 authoritative coordinator for structural/reroot redraws while M2 is pending. Its contract is to serialize structural work, suppress intermediate layouts, drain stale RAF work, run one authoritative final layout, finalize connectors, reveal, and center the selected root.

On any reroot/redraw:

> Do not center while layout is still changing.

Final visible frame must center on the chosen/root person after final coordinates + connectors settle.

## 13. Multi-partner / planar layout principles

Semantic topology outranks visual scoring heuristics.

- children belong to explicit parent pairs/unions;
- multi-partner spouse components can contain 3+ people;
- child groups for different unions remain separable;
- lineage-aware member ordering can outrank simple alternating spouse order;
- sibling/union blocks remain contiguous when required;
- bridge compaction may translate a self-contained branch only when graph-safe;
- router validates/avoids connector crossings and card intersections;
- explicit diagnostics/fallback are preferred over hidden score-only heuristics.

Do not regress the ordinary one-partner visual case while improving multi-partner cases.

## 14. Print / PDF

Print/PDF uses the current visible projection, one-page Letter landscape.
Relevant:

- `public/print-refinement.js`
- `public/print-polish.js`

Refetch current print code before changes because print/avatar behavior has changed historically.

## 15. Places / GeoNames

Autocomplete is conservative:

```text
min query length: 3
debounce: ~450ms
max results: 6
cache TTL: 30 days
external limit guards: hourly/daily caps with headroom
```

Places preserve human-entered text; selected suggestions may additionally store country code, GeoNames ID, lat/long.

## 16. Browser translation

Do not add application localization infrastructure. Product intentionally remains Hebrew and relies on browser translation if desired.

```html
<html lang="he" dir="rtl">
```

No translation APIs/buttons/caches.

## 17. Cloudflare / deployment

`deploy.sh` injects build SHA/time into Worker vars and runs Wrangler.
First-time media setup may need:

```bash
npx wrangler r2 bucket create family-tree-media
```

GeoNames credential may need:

```bash
npx wrangler secret put GEONAMES_USERNAME
```

Worker exposes build info and stamps frontend assets.

## 18. Tests

`npm test` runs unit tests plus frontend/Worker syntax checks.
Important suites include:

- planar core
- person metadata
- person metadata UI
- person identity/disambiguation
- graph invariants
- faces
- **selection-controller**
- **visual-roles**
- **runtime-ownership**

M1 tests specifically guard:

- stored selection restores into URL without relying on a stale DOM root;
- explicit URL selection wins over LocalStorage;
- rendered-root fallback repairs URL + storage;
- selected root cannot remain gray;
- selected-root siblings are primary;
- spouse other-union descendants are contextual;
- spouse ancestry depth classes remain correct;
- node-hover/import-export/interaction do not reacquire runtime ownership;
- final layout stack installs before first graph start;
- graph-sync starts only after first graph render;
- legacy root-context/selection-repair layers are not loaded by runtime-bootstrap.

If adding a significant frontend module, add a syntax check to `package.json`. If adding an isolatable invariant, add a unit test.

## 19. High-value files to refetch before major work

For M1 runtime/selection work:

```text
src/entry.js
public/runtime-bootstrap.js
public/selection-controller.js
public/visual-roles.js
public/graph-view.js
public/interaction-refinement.js
public/node-hover.js
public/import-export.js
public/person-pane.js
public/presentation-refinement.js
public/graph-sync.js
public/graph-render-stability.js
public/revision-layout-guard.js
```

For graph/render work:

```text
public/index.html
public/graph-view.js
public/layout-refinement.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
public/revision-layout-guard.js
public/graph-render-stability.js
public/node-face-footprint.js
public/slice-a-geometry.js
```

For mutations/invariants:

```text
src/worker.js
src/graph-invariants.js
public/union-child-actions.js
public/parent-limit.js
```

For identity/search:

```text
public/person-identity.js
public/person-picker-labels.js
public/person-picker-refresh.js
public/graph-view.js
public/face-tagging-ux.js
```

For media/faces:

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

## 20. Current priority / roadmap

M1 runtime simplification is now implemented on `main` and should be browser-tested before M2.
The intended sequence remains behavior-preserving:

```text
M1 (current)
A deterministic bootstrap
B canonical selection ownership
C unified visual roles

M2 (next, only after M1 validation)
D explicit RenderController
E flatten layout pipeline into named stages
F retire duplicate-layout/render-stability repair guards when proven unnecessary

M3
G graph store/sync consolidation
H replace internal MutationObserver communication with explicit events where practical
I server/asset bootstrap cleanup
J dead-code/remnant removal
```

### M1 browser verification

After deployment verify at least:

1. Initial load/restored root: same person selected, right pane correct, graph centered.
2. Select a gray contextual person once: immediately root + fully active, no second click.
3. Rapidly select several people: final visible root is last selection, centered, connectors coherent.
4. Add child / parent / spouse: layout remains generational, no missing cards, no stale lines.
5. Multi-partner families: union-specific child groups/context styling unchanged.
6. Right-pane edit: no unnecessary topology redraw.
7. Remote revision: sync starts after app ready and retains existing polling/reconciliation behavior.
8. Mobile selection and sheet behavior unchanged.
9. F1 diagnostics show runtime bootstrap `phase: "ready"` and coherent selected root.

Do not begin M2 by rewriting algorithms. First flatten the **existing final behavior** into explicit ownership/stages, then remove wrappers only after equivalence is demonstrated.

## 21. User preferences for interaction

- Answers should be concise and implementation-oriented.
- When architecture is agreed and the user says “do it”, implement rather than only propose.
- User values clean invariants and natural UI behavior over special-case patches.
- Avoid unnecessary backward compatibility when the user explicitly says legacy data can be discarded.
- Preserve Hebrew-first product and browser-translation decision.

---

If this file conflicts with current code, current code + the user’s latest explicit instruction wins. Update this document after resolving the discrepancy.
