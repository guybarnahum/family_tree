(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FamilyPlanarCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function median(values, fallback = 0) {
        const finite = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
        if (!finite.length) return fallback;
        const middle = Math.floor(finite.length / 2);
        return finite.length % 2
            ? finite[middle]
            : (finite[middle - 1] + finite[middle]) / 2;
    }

    function indexMap(order) {
        return new Map((order || []).map((id, index) => [id, index]));
    }

    function endpointRank(index, port) {
        const p = Number.isFinite(port) ? Math.max(0, Math.min(1, port)) : 0.5;
        return index + 0.1 + p * 0.8;
    }

    function crossingPairs(edges, upperOrder, lowerOrder) {
        const upper = indexMap(upperOrder);
        const lower = indexMap(lowerOrder);
        const ranked = [];

        for (const edge of edges || []) {
            if (!upper.has(edge.sourceUnitId) || !lower.has(edge.targetUnitId)) continue;
            ranked.push({
                ...edge,
                sourceRank: endpointRank(upper.get(edge.sourceUnitId), edge.sourcePort),
                targetRank: endpointRank(lower.get(edge.targetUnitId), edge.targetPort)
            });
        }

        const pairs = [];
        for (let i = 0; i < ranked.length; i++) {
            const a = ranked[i];
            for (let j = i + 1; j < ranked.length; j++) {
                const b = ranked[j];
                if (a.sourceKey && a.sourceKey === b.sourceKey) continue;
                if (a.targetKey && a.targetKey === b.targetKey) continue;

                const sourceDelta = a.sourceRank - b.sourceRank;
                const targetDelta = a.targetRank - b.targetRank;
                if (Math.abs(sourceDelta) < 1e-9 || Math.abs(targetDelta) < 1e-9) continue;
                if (sourceDelta * targetDelta < 0) pairs.push([a, b]);
            }
        }
        return pairs;
    }

    function countCrossings(edges, upperOrder, lowerOrder) {
        return crossingPairs(edges, upperOrder, lowerOrder).length;
    }

    function lexicographicCompare(a, b) {
        const aa = String(a);
        const bb = String(b);
        return aa < bb ? -1 : aa > bb ? 1 : 0;
    }

    function bestInsertionOrder(items, costFn, options = {}) {
        let order = [...(items || [])];
        let bestCost = costFn(order);
        if (bestCost === 0) return { order, cost: 0 };
        const maxPasses = options.maxPasses || Math.max(2, order.length * 2);

        for (let pass = 0; pass < maxPasses; pass++) {
            let changed = false;
            for (let from = 0; from < order.length; from++) {
                const item = order[from];
                let localBest = order;
                let localCost = bestCost;

                const rest = [...order];
                rest.splice(from, 1);
                for (let to = 0; to <= rest.length; to++) {
                    const candidate = [...rest.slice(0, to), item, ...rest.slice(to)];
                    const cost = costFn(candidate);
                    if (cost < localCost) {
                        localBest = candidate;
                        localCost = cost;
                        if (localCost === 0) break;
                    }
                }

                if (localBest !== order) {
                    order = localBest;
                    bestCost = localCost;
                    changed = true;
                    if (bestCost === 0) return { order, cost: 0 };
                }
            }
            if (!changed) break;
        }
        return { order, cost: bestCost };
    }

    function exactBestOrder(items, costFn, options = {}) {
        const source = [...(items || [])];
        const maxItems = options.maxItems || 7;
        if (source.length > maxItems) return bestInsertionOrder(source, costFn, options);

        let best = [...source];
        let bestCost = costFn(best);
        if (bestCost === 0) return { order: best, cost: 0 };

        function visit(prefix, remaining) {
            if (bestCost === 0) return;
            if (!remaining.length) {
                const cost = costFn(prefix);
                if (cost < bestCost) {
                    best = [...prefix];
                    bestCost = cost;
                }
                return;
            }
            const sorted = [...remaining].sort(lexicographicCompare);
            for (const item of sorted) {
                if (bestCost === 0) break;
                const next = remaining.filter(value => value !== item);
                visit([...prefix, item], next);
            }
        }

        if (source.length > 1) visit([], source);
        return { order: best, cost: bestCost };
    }

    return {
        median,
        endpointRank,
        crossingPairs,
        countCrossings,
        bestInsertionOrder,
        exactBestOrder
    };
});
