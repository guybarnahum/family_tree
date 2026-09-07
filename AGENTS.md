# AGENTS.md — family_tree continuity guide

This file is the authoritative handoff for AI/code agents working on `guybarnahum/family_tree`.
Read it before changing the repository. Update it when architecture/invariants materially change.

## 1. Working style / repo rules

- Work directly on `main` unless the user explicitly asks for a PR.
- **Do not create PRs by default.**
- Refetch the current file SHA before every write; do not reuse stale SHAs.
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
- Current root should persist across reloads.
- The rendering system should programmatically restore the selected/root person from URL/LocalStorage.
- Side/collateral expansions are ephemeral and clear on reroot.

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

`spouse` should be understood topologically as the family/partner **union** edge. Do not over-interpret it as current legal marital status.

### Parent limit

A person may have at most **two explicit canonical parent relationships**.

### Parent-union invariant

If a child has two parents, those two parents must be connected by the same union/spouse edge.

Canonical rule:

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

For 2+ spouses, child creation is **union-specific**: the user chooses the spouse/union, and the child is created with both members of that union as explicit parents.

This is critical. Never infer which spouse is the co-parent when there are multiple possible spouses.

### Adding a second parent

If a child has one explicit parent and the user adds/selects a second parent, atomically ensure:

```text
parent2 → child
parent1 ↔ parent2
```

The frontend should express the intent; backend/graph normalization owns the invariant.

## 4. Person names and picker identity

Canonical name normalization everywhere:

```js
String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')
```

Use it:

- on save/import/backend normalization;
- for name-collision grouping;
- for search/picker identity.

Do **not** remove all internal spaces. Only normalize formatting whitespace.

### Duplicate names / disambiguation

There is a shared person identity/disambiguation layer (`public/person-identity.js` and picker helpers).
Collision checks happen on normalized names.

Unique names stay visually unchanged.
For collision groups, use the shortest useful gender-neutral Hebrew qualifier, roughly:

1. parent identity: `הורה: X`
2. child identity: `הורה של Y`
3. spouse identity: `בן/בת זוג: Z`
4. life dates
5. place
6. combine qualifiers only if still ambiguous
7. internal ID only as pathological fallback

Do not add gender merely to solve Hebrew grammar.

Build the disambiguation index once per canonical graph state/revision, not independently in every picker.

All person pickers/searches should consume the same derived identity presentation:

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
- add child (when unambiguous)
- delete X
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

All optional.
Dates are arbitrary text strings, not calendar-only values.
Places may preserve human text plus structured GeoNames fields.

No separate View/Edit mode: inline editing in the same pane.
Empty optional values normally stay visually quiet.

### Legacy metadata decision

Do **not** revive old `dates` or `description` migration behavior. The user explicitly accepted losing legacy values because there were effectively none.

### Save behavior

- Unchanged pane fields must be true no-ops (no PATCH, no revision bump).
- Unchanged graph-card name blur must also be a no-op.
- Successful pane edits should update in-memory/cached canonical data directly when safe, avoiding a redundant full graph fetch/redraw.

## 6. New-person UX

After creating a child/person through graph actions:

- select/reroot appropriately;
- focus the new person’s right-pane name editor;
- place keyboard focus ready for typing;
- on mobile, open the pane/sheet as needed.

Relevant helper: `public/new-person-focus.js`.

Deleting a completely unfilled placeholder person should happen without a confirmation dialog.
Populated people or people with meaningful data/media should still use protective confirmation.

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

Context dimming must be relative to the selected person.
Example: if Anat is selected and Guy has another spouse:

- Anat’s siblings remain primary, not gray.
- Guy remains primary as Anat’s spouse.
- Guy’s **other spouse** is contextual/gray.
- Descendants belonging to Guy + that other spouse’s union are contextual/gray.

Do not simply gray all siblings or all spouse branches globally.
Relevant refinement: `public/root-context-refinement.js`.

## 8. Media / R2

D1 schema includes `media` and `media_people`; original bytes live in R2.

Media is associated with people, not owned by one person.

Key routes include:

```text
GET/POST   /api/media?person=ID
PATCH/DELETE /api/media/:id
GET        /api/media/:id/content
```

Uploads are capped at about 15 MB; supported image types include JPEG/PNG/WebP/GIF/AVIF.

R2 object key is deterministic (`media/{id}/original`), so content reads should not require D1 just to discover the key.

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

Half the circle extends outside the card.
Layout measurement must reserve that outside half-diameter so neighboring nodes do not crowd the avatar.

Relevant files:

- `public/node-face-decoration.js`
- `public/node-face-footprint.js`

Portrait changes should not trigger unnecessary graph topology redraws; only reflow when the set/footprint of avatars actually changes.

## 10. D1 usage / graph caching / revision sync

This architecture exists because the old app polled the **entire graph every 5 seconds**, and nested layout wrappers could multiply that into several full `/api/graph` reads per tick, enough to exceed D1 free-tier row-read limits.

### Revision table

Use a singleton D1 graph/data revision row (`graph_state`) as cheap stale detection.
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

One revision row is much cheaper than repeatedly reading all people + relationships.

### Poll policy

Current intended policy:

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

Mouse/pointer movement counts as activity.
Never overlap revision requests.

### Reconciliation rate limit

Revision discovery is fast, UI reconciliation is intentionally slower:

- remote revision checks may see many changes;
- coalesce them;
- perform at most about **one graph reconciliation/redraw per 30 seconds** during a burst;
- jump directly to the latest revision.

A revision change does **not** automatically mean a graph layout is needed.
If names/topology are unchanged and only metadata/media/faces changed, graph rendering should remain visually inert when possible.

### Cache role

`public/graph-cache.js` is not outage-only; clean cached graph data is the normal local source.
Full `/api/graph` reads occur when cache is missing, dirty, stale, or an authoritative reconciliation is required.

### Debug tray

F1 toggles the graph/debug tray (with `Ctrl+Shift+D` fallback).
Use it when diagnosing sync/render bugs.
It shows revision state, frequencies, cache state, graph fetch counts, mutation details, reconciliation/layout metrics, etc.

Relevant files:

- `public/graph-cache.js`
- `public/graph-resilience.js`
- `public/graph-sync.js`
- `public/graph-debug.js`
- `public/revision-layout-guard.js`

## 11. Rendering/layout architecture — IMPORTANT

The app has accumulated several historical layout/refinement wrappers. This is the highest-risk area.

Core/base geometry lives in `public/index.html`.
Person-centric projection: `public/graph-view.js`.
Then topology/layout refinements include:

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
```

### Historic failure pattern

A structural edit/reroot could previously produce malformed transient/final renders:

- missing nodes
- connectors drawn from stale coordinates
- shifted card layout
- incomplete/incorrect multi-partner union geometry

The underlying race was:

1. graph-view replaced cards / started a render;
2. some topology-aware wrappers had not refreshed their relationship indexes yet;
3. old `requestAnimationFrame` callbacks from the previous graph/root were still queued;
4. mutation duplicate-layout guards could suppress the later corrective layout because `dataSignature` looked the same;
5. connector SVG could therefore be drawn against stale or intermediate coordinates.

Do not “fix” this by blindly adding more redraws.

### Current stabilization coordinator

Current head introduced `public/graph-render-stability.js`.
This is the authoritative coordinator for structural redraws and root-selection redraws.

Its intended contract:

- install only after the final planar/router stack is ready;
- serialize structural graph redraws;
- suppress intermediate layouts while wrapper/index refreshes settle;
- drain stale RAF work;
- run one authoritative final layout against coherent topology;
- draw final connectors only after layout settles;
- hide the canvas while a root-selection render is incomplete so intermediate centers are never painted;
- center only after the graph is fully settled;
- center around the selected/root node;
- persist/recover the root through `family-tree.anchor-person`;
- cancel/supersede stale selection transactions;
- fold a root replacement that occurs during an active structural transaction into that same transaction rather than starting a competing redraw.

Diagnostics:

```js
window.__familyRenderStabilityDiagnostics
window.FamilyGraphRenderStability
```

The most recent rendering commits before this handoff were:

```text
c86c88de Serialize graph redraws and settle root centering
...
3b766345 Cancel superseded graph render transactions
...
5fe8afd0 Fold root replacement into active structural render
```

At the moment of writing this guide, `5fe8afd0...` was the code head immediately before adding `AGENTS.md`.

### Centering invariant

On any reroot/redraw:

> Do not center while layout is still changing.

The visible final frame should be centered on the chosen/root person **after** final card coordinates + connector geometry settle.

Do not let older `requestAnimationFrame` callbacks recenter a newer root.
Do not center on an arbitrary family-unit heuristic when a selected/root person exists.

### Root source order

For render stabilization, use the actual current root card / URL / LocalStorage coherently.
`family-tree.anchor-person` must remain synchronized with selection.

## 12. Multi-partner / planar layout principles

For layout correctness, semantic topology outranks visual scoring heuristics.

Important principles:

- children belong to explicit parent pairs/unions;
- multi-partner spouse components can contain 3+ people;
- different child groups for different unions must remain separable;
- lineage-aware member ordering can be the final authority over simple alternating spouse order;
- sibling/union blocks should stay contiguous when required;
- bridge compaction may translate a self-contained branch only when graph-safe;
- router validates/avoids connector crossings and card intersections;
- explicit diagnostics/fallback are preferred over hidden score-only heuristics.

Do not regress the ordinary one-partner visual case while improving multi-partner cases.

## 13. Print / PDF

Print/PDF uses the current visible family projection, one-page Letter landscape.
There have been dedicated refinements for title typography, transparency, and face crop behavior.
Before changing print behavior, refetch current print CSS/scripts because print-avatar behavior has changed historically.

Relevant:

- `public/print-refinement.js`
- `public/print-polish.js`

## 14. Places / GeoNames

Autocomplete is conservative:

```text
min query length: 3
debounce: ~450ms
max results: 6
cache TTL: 30 days
external limit guards: hourly/daily caps with headroom
```

Places preserve human-entered text; a selected suggestion may additionally store country code, GeoNames ID, lat/long.

## 15. Browser translation

Do not add application localization infrastructure.
The product intentionally remains Hebrew and relies on browser translation if the user wants another language.

HTML remains roughly:

```html
<html lang="he" dir="rtl">
```

No translation APIs, translation buttons, translation caches, etc.

## 16. Cloudflare / deployment details

`deploy.sh` injects build SHA/time into Worker vars and runs Wrangler.

First-time media setup may need:

```bash
npx wrangler r2 bucket create family-tree-media
```

GeoNames credential may need:

```bash
npx wrangler secret put GEONAMES_USERNAME
```

The Worker injects/build-stamps refinement scripts and exposes build info.

## 17. Tests

`npm test` currently runs unit tests and extensive syntax checks.
Important suites include:

- planar core
- person metadata
- person metadata UI
- person identity/disambiguation
- graph invariants
- faces

It also syntax-checks the major Worker and frontend refinement files, including:

- graph sync/cache/resilience/debug
- graph render stability
- person pane/media/faces
- parent/union actions
- planar/member/bridge/router stack

If adding a new significant frontend module, add a syntax check to `package.json`.
If adding an invariant that can be isolated, add a unit test.

## 18. High-value files to refetch before major work

For graph/render work:

```text
public/index.html
public/graph-view.js
public/multi-partner-refinement.js
public/planar-layout.js
public/member-order-refinement.js
public/bridge-compaction.js
public/planar-router.js
public/revision-layout-guard.js
public/graph-render-stability.js
public/graph-sync.js
public/graph-cache.js
public/graph-resilience.js
public/node-hover.js
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

## 19. Current priority / handoff state

The immediate bug under investigation before this handoff was intermittent malformed rendering when:

- selecting/rerooting on a person;
- especially immediately after adding a child to a parent;
- symptoms: connectors out of place, missing nodes, shifted layout.

The latest code attempts to solve this at the transaction/order level with `graph-render-stability.js`, not by increasing redraw frequency.

Next agent should:

1. Refetch current `main` and recent commits before touching anything.
2. Read `public/graph-render-stability.js` completely.
3. Reproduce the sequence: add child → structural graph write → reroot/select child or parent → final render.
4. Use F1/debug plus `window.__familyRenderStabilityDiagnostics`, layout diagnostics, and route diagnostics.
5. Verify only one authoritative final layout is visible for a structural operation.
6. Verify old RAF callbacks cannot center/draw a superseded root.
7. Verify final centering occurs after connectors/layout settle and is on the actual selected/root node.
8. Verify LocalStorage root restoration works without starting a competing selection transaction.
9. Avoid adding another independent layout timer or observer unless absolutely necessary.
10. Prefer consolidating render ownership over stacking another wrapper.

## 20. User preferences for interaction

- Answers should be concise and implementation-oriented.
- When architecture is agreed and the user says “do it”, implement rather than only propose.
- The user values clean invariants and natural UI behavior over special-case patches.
- Avoid unnecessary backward compatibility when the user explicitly says legacy data can be discarded.
- Preserve the existing Hebrew-first product and browser-translation decision.

---

If this file conflicts with current code, current code + the user’s latest explicit instruction wins. Update this document after resolving the discrepancy.
