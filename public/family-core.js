// Foundational card and geometry primitives. Runtime execution belongs to RenderController.
let globalNodes = [];
let globalNodeMap = new Map();
let globalUnits = [];
let unitByNodeId = new Map();

const SPOUSE_EDGE_GAP = 34;
const UNIT_GAP = 90;
const CANVAS_PAD_X = 240;
const CANVAS_PAD_TOP = 180;
const CANVAS_PAD_BOTTOM = 220;
const CARD_FALLBACK_WIDTH = 170;
const CARD_FALLBACK_HEIGHT = 100;
const DESKTOP_GENERATION_GAP = 96;
const MOBILE_GENERATION_GAP = 84;
const COMPACT_BAND_FALLBACK = 56;
const MOBILE_CANVAS_PAD_TOP = 150;
const ORDER_SWEEPS = 8;
const POSITION_SWEEPS = 10;
const CONNECTOR_KNEE_RADIUS = 10;

const viewport = document.getElementById('scroll-viewport');
const canvas = document.getElementById('canvas');
const cardsLayer = document.getElementById('cards-layer');
const svgLayer = document.getElementById('svg-layer');
const geometryMobileQuery = window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)');

function escapeHTML(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function captureAnchor(preferredId = null) {
    let node = preferredId ? globalNodeMap.get(preferredId) : null;
    if (!node && globalNodes.length) {
        const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
        const centerY = viewport.scrollTop + viewport.clientHeight / 2;
        node = globalNodes.reduce((best, candidate) => {
            if (candidate.x == null || candidate.targetY == null) return best;
            const d = Math.abs(candidate.x - centerX) + Math.abs(candidate.targetY - centerY);
            return !best || d < best.d ? { node: candidate, d } : best;
        }, null)?.node;
    }
    if (!node || node.x == null || node.targetY == null) return null;
    return {
        id: node.id,
        screenX: node.x - viewport.scrollLeft,
        screenY: node.targetY - viewport.scrollTop
    };
}

function restoreAnchor(anchor) {
    if (!anchor) return;
    const node = globalNodeMap.get(anchor.id);
    if (!node || node.x == null || node.targetY == null) return;
    viewport.scrollLeft = Math.max(0, node.x - anchor.screenX);
    viewport.scrollTop = Math.max(0, node.targetY - anchor.screenY);
}

function createCardHTML(node) {
    const hasParent = !!node.parent_id && globalNodeMap.has(node.parent_id);
    const id = escapeHTML(node.id);
    return `
        <div id="card-${id}" data-node-id="${id}"
             class="absolute-card pointer-events-auto bg-white px-3 py-2 w-max min-w-[140px] max-w-[200px] shadow-md border-t-[3px] border-leaf rounded-lg z-20">
            <button data-action="delete" data-id="${id}"
                    class="absolute -top-1.5 -left-1.5 text-red-300 hover:text-red-500 font-bold bg-white rounded-full w-4 h-4 flex items-center justify-center shadow z-30 transition text-[10px]">✕</button>
            ${!hasParent ? `
                <button data-action="add-parent" data-id="${id}"
                        class="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-leaf-light text-white text-[8px] px-2 py-0.5 rounded-full hover:bg-leaf shadow z-30 transition">+ הורה</button>
            ` : ''}
            <button data-action="add-spouse" data-id="${id}"
                    class="absolute -top-2.5 right-1 bg-pink-100 text-pink-700 text-[8px] px-2 py-0.5 rounded-full hover:bg-pink-200 shadow z-30 transition whitespace-nowrap">+ בן/בת זוג</button>

            <h2 data-id="${id}" data-field="name"
                class="font-script font-bold text-xl text-leaf-dark mt-1 mb-0.5 text-center break-words rounded min-h-[28px] leading-tight">${escapeHTML(node.name || 'שם')}</h2>
            <p data-id="${id}" data-field="dates"
               class="text-center text-[9px] text-gray-500 mb-1 break-words rounded">${escapeHTML(node.dates || 'תאריכים')}</p>
            <p data-id="${id}" data-field="description"
               class="text-[9px] text-gray-600 text-center break-words rounded leading-tight">${escapeHTML(node.description || 'תיאור')}</p>

            <button data-action="add-child" data-id="${id}"
                    class="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-leaf text-white text-[8px] px-2 py-0.5 rounded-full hover:bg-leaf-dark shadow z-30 transition">+ ילד</button>
        </div>`;
}

function renderCards() {
    cardsLayer.innerHTML = globalNodes.map(createCardHTML).join('');
}

function measureCards() {
    globalNodes.forEach(node => {
        const card = document.getElementById(`card-${node.id}`);
        const rect = card?.getBoundingClientRect();
        node.cardWidth = Math.max(1, rect?.width || CARD_FALLBACK_WIDTH);
        node.cardHeight = Math.max(1, rect?.height || CARD_FALLBACK_HEIGHT);
    });
}

function buildFamilyUnits() {
    globalUnits = [];
    unitByNodeId = new Map();
    const claimed = new Set();
    const reverseSpouse = new Map();

    for (const node of globalNodes) {
        if (node.spouse_id && globalNodeMap.has(node.spouse_id)) reverseSpouse.set(node.spouse_id, node);
    }

    const sorted = [...globalNodes].sort((a, b) => a.id.localeCompare(b.id));
    for (const node of sorted) {
        if (claimed.has(node.id)) continue;
        const directSpouse = node.spouse_id ? globalNodeMap.get(node.spouse_id) : null;
        const spouse = directSpouse || reverseSpouse.get(node.id) || null;
        let members = [node];

        if (spouse && !claimed.has(spouse.id) && spouse.id !== node.id) {
            members = [node, spouse].sort((a, b) => a.id.localeCompare(b.id));
            claimed.add(spouse.id);
        }
        claimed.add(node.id);

        const unit = {
            id: members.map(member => member.id).join('::'),
            members,
            parents: new Set(),
            children: new Set(),
            gen: null,
            width: 0,
            height: 0,
            centerX: 0,
            component: -1
        };
        globalUnits.push(unit);
        members.forEach(member => unitByNodeId.set(member.id, unit));
    }

    for (const unit of globalUnits) {
        for (const member of unit.members) {
            const parentUnit = member.parent_id ? unitByNodeId.get(member.parent_id) : null;
            if (parentUnit && parentUnit !== unit) {
                unit.parents.add(parentUnit);
                parentUnit.children.add(unit);
            }
        }
    }

    for (const unit of globalUnits) {
        unit.width = unit.members.length === 2
            ? unit.members[0].cardWidth + SPOUSE_EDGE_GAP + unit.members[1].cardWidth
            : unit.members[0].cardWidth;
        unit.height = Math.max(...unit.members.map(member => member.cardHeight));
    }
}

function assignGenerations() {
    globalUnits.forEach(unit => {
        unit.gen = null;
        unit.component = -1;
    });

    let componentId = 0;
    const seeds = [...globalUnits].sort((a, b) => a.id.localeCompare(b.id));
    for (const seed of seeds) {
        if (seed.gen !== null) continue;
        seed.gen = 0;
        seed.component = componentId;
        const queue = [seed];
        const component = [];
        let conflict = false;

        while (queue.length) {
            const unit = queue.shift();
            component.push(unit);
            const neighbors = [
                ...[...unit.parents].map(parent => ({ unit: parent, expected: unit.gen - 1 })),
                ...[...unit.children].map(child => ({ unit: child, expected: unit.gen + 1 }))
            ].sort((a, b) => a.unit.id.localeCompare(b.unit.id));

            for (const edge of neighbors) {
                if (edge.unit.gen === null) {
                    edge.unit.gen = edge.expected;
                    edge.unit.component = componentId;
                    queue.push(edge.unit);
                } else if (edge.unit.gen !== edge.expected) {
                    conflict = true;
                    console.error('Inconsistent family generation constraints:', unit.id, '->', edge.unit.id,
                        'expected', edge.expected, 'found', edge.unit.gen);
                }
            }
        }

        const minGen = Math.min(...component.map(unit => unit.gen));
        component.forEach(unit => unit.gen -= minGen);
        if (conflict) console.warn('This family component contains contradictory parent/spouse generation constraints.');
        componentId++;
    }

    globalUnits.forEach(unit => unit.members.forEach(member => member.gen = unit.gen));
}

function generationsMap() {
    const byGen = new Map();
    for (const unit of globalUnits) {
        if (!byGen.has(unit.gen)) byGen.set(unit.gen, []);
        byGen.get(unit.gen).push(unit);
    }
    return byGen;
}

function indexMap(units) {
    return new Map(units.map((unit, index) => [unit, index]));
}

function average(values, fallback = 0) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function parentSignature(unit) {
    if (!unit.parents.size) return `~${unit.id}`;
    return [...unit.parents].map(parent => parent.id).sort().join('|');
}

function siblingBlocks(units) {
    const oldIndex = indexMap(units);
    const groups = new Map();
    for (const unit of units) {
        const key = parentSignature(unit);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(unit);
    }
    return [...groups.entries()].map(([key, members]) => ({
        key,
        members: members.sort((a, b) => oldIndex.get(a) - oldIndex.get(b) || a.id.localeCompare(b.id)),
        old: average(members.map(member => oldIndex.get(member)))
    })).sort((a, b) => a.old - b.old || a.key.localeCompare(b.key));
}

function orderGenerations(byGen) {
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    gens.forEach(gen => byGen.get(gen).sort((a, b) => a.id.localeCompare(b.id)));

    for (let pass = 0; pass < ORDER_SWEEPS; pass++) {
        for (let gi = 1; gi < gens.length; gi++) {
            const prevIndex = indexMap(byGen.get(gens[gi - 1]));
            const blocks = siblingBlocks(byGen.get(gens[gi]));
            for (const block of blocks) {
                const positions = block.members.flatMap(member =>
                    [...member.parents].filter(parent => prevIndex.has(parent)).map(parent => prevIndex.get(parent))
                );
                block.score = positions.length ? average(positions) : block.old;
            }
            blocks.sort((a, b) => a.score - b.score || a.old - b.old || a.key.localeCompare(b.key));
            byGen.set(gens[gi], blocks.flatMap(block => block.members));
        }

        for (let gi = gens.length - 2; gi >= 0; gi--) {
            const nextIndex = indexMap(byGen.get(gens[gi + 1]));
            const blocks = siblingBlocks(byGen.get(gens[gi]));
            for (const block of blocks) {
                const oldMemberIndex = indexMap(block.members);
                block.members.sort((a, b) => {
                    const aChildren = [...a.children].filter(child => nextIndex.has(child)).map(child => nextIndex.get(child));
                    const bChildren = [...b.children].filter(child => nextIndex.has(child)).map(child => nextIndex.get(child));
                    const ax = aChildren.length ? average(aChildren) : oldMemberIndex.get(a);
                    const bx = bChildren.length ? average(bChildren) : oldMemberIndex.get(b);
                    return ax - bx || oldMemberIndex.get(a) - oldMemberIndex.get(b) || a.id.localeCompare(b.id);
                });
                const positions = block.members.flatMap(member =>
                    [...member.children].filter(child => nextIndex.has(child)).map(child => nextIndex.get(child))
                );
                block.score = positions.length ? average(positions) : block.old;
            }
            blocks.sort((a, b) => a.score - b.score || a.old - b.old || a.key.localeCompare(b.key));
            byGen.set(gens[gi], blocks.flatMap(block => block.members));
        }
    }
}

function unitSeparation(left, right) {
    return left.width / 2 + UNIT_GAP + right.width / 2;
}

function compactGeneration(units, targets) {
    if (!units.length) return;
    if (units.length === 1) {
        units[0].centerX = targets.get(units[0]) ?? units[0].centerX ?? 0;
        return;
    }
    const positions = units.map(unit => {
        const target = targets.get(unit);
        return Number.isFinite(target) ? target : (Number.isFinite(unit.centerX) ? unit.centerX : 0);
    });
    for (let i = 1; i < units.length; i++) {
        positions[i] = Math.max(positions[i], positions[i - 1] + unitSeparation(units[i - 1], units[i]));
    }
    for (let i = units.length - 2; i >= 0; i--) {
        positions[i] = Math.min(positions[i], positions[i + 1] - unitSeparation(units[i], units[i + 1]));
    }
    const requested = units.map((unit, index) => {
        const value = targets.get(unit);
        return Number.isFinite(value) ? value : positions[index];
    });
    const delta = average(requested.map((value, index) => value - positions[index]));
    units.forEach((unit, index) => unit.centerX = positions[index] + delta);
}

function simplePack(units) {
    if (!units.length) return;
    let cursor = 0;
    for (const unit of units) {
        unit.centerX = cursor + unit.width / 2;
        cursor += unit.width + UNIT_GAP;
    }
    const total = cursor - UNIT_GAP;
    units.forEach(unit => unit.centerX -= total / 2);
}

function layoutUnits() {
    const byGen = generationsMap();
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    orderGenerations(byGen);
    gens.forEach(gen => simplePack(byGen.get(gen)));

    for (let pass = 0; pass < POSITION_SWEEPS; pass++) {
        for (let gi = gens.length - 2; gi >= 0; gi--) {
            const units = byGen.get(gens[gi]);
            const targets = new Map();
            for (const unit of units) {
                const children = [...unit.children].filter(child => child.gen === unit.gen + 1);
                targets.set(unit, children.length ? average(children.map(child => child.centerX)) : unit.centerX);
            }
            compactGeneration(units, targets);
        }
        for (let gi = 1; gi < gens.length; gi++) {
            const units = byGen.get(gens[gi]);
            const targets = new Map();
            for (const unit of units) {
                const parents = [...unit.parents].filter(parent => parent.gen === unit.gen - 1);
                targets.set(unit, parents.length ? average(parents.map(parent => parent.centerX)) : unit.centerX);
            }
            compactGeneration(units, targets);
        }
    }

    for (let gi = gens.length - 2; gi >= 0; gi--) {
        const units = byGen.get(gens[gi]);
        const targets = new Map();
        for (const unit of units) {
            const children = [...unit.children].filter(child => child.gen === unit.gen + 1);
            targets.set(unit, children.length ? average(children.map(child => child.centerX)) : unit.centerX);
        }
        compactGeneration(units, targets);
    }

    const minLeft = Math.min(...globalUnits.map(unit => unit.centerX - unit.width / 2));
    const offsetX = CANVAS_PAD_X - minLeft;
    globalUnits.forEach(unit => unit.centerX += offsetX);
    return byGen;
}

function assignVerticalPositions(byGen) {
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    const generationGap = geometryMobileQuery.matches ? MOBILE_GENERATION_GAP : DESKTOP_GENERATION_GAP;
    let bandTop = geometryMobileQuery.matches ? MOBILE_CANVAS_PAD_TOP : CANVAS_PAD_TOP;
    for (const gen of gens) {
        const units = byGen.get(gen);
        const bandHeight = Math.max(...units.map(unit => unit.height), COMPACT_BAND_FALLBACK);
        const centerY = bandTop + bandHeight / 2;
        for (const unit of units) {
            unit.generationCenterY = centerY;
            for (const member of unit.members) {
                member.generationCenterY = centerY;
                member.targetY = centerY - member.cardHeight / 2;
            }
        }
        bandTop += bandHeight + generationGap;
    }
}

function memberLineageTargetX(member) {
    const unit = unitByNodeId.get(member.id);
    if (!unit) return null;
    if (member.parent_id) {
        const parentUnit = unitByNodeId.get(member.parent_id);
        if (parentUnit && parentUnit.gen === unit.gen - 1) return parentUnit.centerX;
    }
    const childUnits = globalNodes
        .filter(child => child.parent_id === member.id)
        .map(child => unitByNodeId.get(child.id))
        .filter(childUnit => childUnit && childUnit.gen === unit.gen + 1);
    return childUnits.length ? average(childUnits.map(childUnit => childUnit.centerX)) : null;
}

function orientCouples() {
    for (const unit of globalUnits) {
        if (unit.members.length !== 2) continue;
        const [a, b] = unit.members;
        const ax = memberLineageTargetX(a);
        const bx = memberLineageTargetX(b);
        let left = a;
        let right = b;
        if (Number.isFinite(ax) && Number.isFinite(bx) && Math.abs(ax - bx) > 1) {
            if (ax > bx) [left, right] = [b, a];
        } else if (Number.isFinite(ax) && !Number.isFinite(bx)) {
            if (ax > unit.centerX + 1) [left, right] = [b, a];
        } else if (!Number.isFinite(ax) && Number.isFinite(bx)) {
            if (bx < unit.centerX - 1) [left, right] = [b, a];
        }
        unit.members = [left, right];
    }
}

function positionMembers() {
    orientCouples();
    for (const unit of globalUnits) {
        if (unit.members.length === 1) {
            unit.members[0].x = unit.centerX;
            continue;
        }
        const [left, right] = unit.members;
        left.x = unit.centerX - (SPOUSE_EDGE_GAP / 2 + left.cardWidth / 2);
        right.x = unit.centerX + (SPOUSE_EDGE_GAP / 2 + right.cardWidth / 2);
    }
}

function updateCanvasBounds() {
    const maxRight = Math.max(...globalNodes.map(node => node.x + node.cardWidth / 2));
    const maxBottom = Math.max(...globalNodes.map(node => node.targetY + node.cardHeight));
    const width = Math.max(viewport.clientWidth, Math.ceil(maxRight + CANVAS_PAD_X));
    const height = Math.max(viewport.clientHeight, Math.ceil(maxBottom + CANVAS_PAD_BOTTOM));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    svgLayer.setAttribute('width', width);
    svgLayer.setAttribute('height', height);
    svgLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
}

function syncCardPositions() {
    globalNodes.forEach(node => {
        const card = document.getElementById(`card-${node.id}`);
        if (!card) return;
        card.style.left = `${node.x}px`;
        card.style.top = `${node.targetY}px`;
    });
}

function svgPath(d, width = 2) {
    return `<path d="${d}" stroke="#a3b18a" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`;
}

function roundedOrthogonalPath(points, radius = CONNECTOR_KNEE_RADIUS) {
    if (!points?.length) return '';
    if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        if (i === points.length - 1) {
            d += ` L ${x1} ${y1}`;
            continue;
        }
        const [x2, y2] = points[i + 1];
        const firstHorizontal = Math.abs(y1 - y0) < 0.5;
        const firstVertical = Math.abs(x1 - x0) < 0.5;
        const secondHorizontal = Math.abs(y2 - y1) < 0.5;
        const secondVertical = Math.abs(x2 - x1) < 0.5;
        const isElbow = (firstHorizontal && secondVertical) || (firstVertical && secondHorizontal);
        if (!isElbow) {
            d += ` L ${x1} ${y1}`;
            continue;
        }
        const segment1 = Math.hypot(x1 - x0, y1 - y0);
        const segment2 = Math.hypot(x2 - x1, y2 - y1);
        const r = Math.min(radius, segment1 / 2, segment2 / 2);
        const dx1 = Math.sign(x1 - x0);
        const dy1 = Math.sign(y1 - y0);
        const dx2 = Math.sign(x2 - x1);
        const dy2 = Math.sign(y2 - y1);
        d += ` L ${x1 - dx1 * r} ${y1 - dy1 * r}`;
        d += ` Q ${x1} ${y1} ${x1 + dx2 * r} ${y1 + dy2 * r}`;
    }
    return d;
}

function assertLayout() {
    const byGen = new Map();
    globalNodes.forEach(node => {
        if (!byGen.has(node.gen)) byGen.set(node.gen, []);
        byGen.get(node.gen).push(node);
    });
    for (const [gen, nodes] of byGen) {
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                const xOverlap = Math.abs(a.x - b.x) < (a.cardWidth + b.cardWidth) / 2 - 0.5;
                const yOverlap = Math.abs(a.targetY - b.targetY) < Math.min(a.cardHeight, b.cardHeight) - 0.5;
                if (xOverlap && yOverlap) console.error(`Layout overlap in generation ${gen}:`, a.id, b.id);
            }
        }
    }
    globalNodes.forEach(child => {
        if (!child.parent_id) return;
        const parent = globalNodeMap.get(child.parent_id);
        if (parent && child.gen !== parent.gen + 1) {
            console.error('Parent/child edge is not exactly one generation:', parent.id, parent.gen, '->', child.id, child.gen);
        }
    });
    for (const unit of globalUnits) {
        if (unit.members.length !== 2) continue;
        const [a, b] = unit.members;
        if (a.gen !== b.gen) console.error('Spouses on different generations:', a.id, b.id);
        const actualGap = (b.x - b.cardWidth / 2) - (a.x + a.cardWidth / 2);
        if (Math.abs(actualGap - SPOUSE_EDGE_GAP) > 0.5) console.error('Spouse gap violated:', a.id, b.id, actualGap);
    }
}

function showStatus(msg) {
    const status = document.getElementById('status');
    if (!status) return;
    status.innerText = msg;
    status.classList.remove('opacity-0');
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => status.classList.add('opacity-0'), 1800);
}

window.__familyCoreInstalled = true;
