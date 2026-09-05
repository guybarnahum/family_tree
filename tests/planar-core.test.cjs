const assert = require('assert');
const core = require('../public/planar-core.js');

function edge(sourceUnitId, targetUnitId, sourceKey, targetKey, sourcePort = 0.5, targetPort = 0.5) {
    return { sourceUnitId, targetUnitId, sourceKey, targetKey, sourcePort, targetPort };
}

// Two parent/union sources with contiguous child blocks must be crossing-free.
{
    const edges = [
        edge('A', 'a1', 'A', 'a1'), edge('A', 'a2', 'A', 'a2'),
        edge('B', 'b1', 'B', 'b1'), edge('B', 'b2', 'B', 'b2')
    ];
    assert.equal(core.countCrossings(edges, ['A', 'B'], ['a1', 'a2', 'b1', 'b2']), 0);
    assert(core.countCrossings(edges, ['A', 'B'], ['a1', 'b1', 'a2', 'b2']) > 0);
}

// Exact small-row search recovers the zero-crossing order.
{
    const edges = [
        edge('A', 'X', 'A', 'x', 0.2, 0.2),
        edge('B', 'Y', 'B', 'y', 0.8, 0.8)
    ];
    const result = core.exactBestOrder(
        ['Y', 'X'],
        order => core.countCrossings(edges, ['A', 'B'], order)
    );
    assert.deepEqual(result.order, ['X', 'Y']);
    assert.equal(result.cost, 0);
}

// Two distinct ancestry branches entering opposite ports of one couple meet at endpoints,
// rather than crossing each other.
{
    const edges = [
        edge('P1', 'C', 'p1', 'c-left', 0.5, 0.2),
        edge('P2', 'C', 'p2', 'c-right', 0.5, 0.8)
    ];
    assert.equal(core.countCrossings(edges, ['P1', 'P2'], ['C']), 0);
}

console.log('planar-core tests passed');
