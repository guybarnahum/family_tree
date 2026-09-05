// Print-only visual corrections layered after print-refinement.js.
// Preserve the exact measured card geometry used to draw connectors while allowing
// placeholder fields to be omitted from the PDF clone, and neutralize contextual dimming.
(() => {
    if (window.__familyPrintPolish) return;
    window.__familyPrintPolish = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const style = document.createElement('style');
    style.textContent = `
        @media print {
            .family-print-title {
                font-family: "Frank Ruhl Libre", serif !important;
                font-size: 32px !important;
                font-weight: 700 !important;
                line-height: 44px !important;
                text-align: right !important;
                direction: rtl !important;
            }

            .family-print-graph .absolute-card,
            .family-print-graph .absolute-card.graph-context,
            .family-print-graph .absolute-card.graph-spouse-parent,
            .family-print-graph .absolute-card.graph-spouse-ancestor-deep {
                opacity: 1 !important;
                filter: none !important;
                background: #fff !important;
            }
        }
    `;
    document.head.appendChild(style);

    function originalCardFor(printCard) {
        const id = printCard.dataset.nodeId;
        if (!id) return null;
        return [...cardsLayer.querySelectorAll('.absolute-card[data-node-id]')]
            .find(card => card.dataset.nodeId === id) || null;
    }

    function preservePrintedCardGeometry(sheet) {
        if (!sheet) return;

        sheet.querySelectorAll('.family-print-graph .absolute-card[data-node-id]').forEach(printCard => {
            const original = originalCardFor(printCard);
            if (!original) return;

            const rect = original.getBoundingClientRect();
            if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
                rect.width <= 0 || rect.height <= 0) return;

            // print-refinement removes placeholder elements from the clone. Without an
            // explicit outer size that shrinks the card after the SVG has already been
            // drawn from the live geometry, shifting marriage/parent/child line centers.
            printCard.style.setProperty('width', `${rect.width}px`, 'important');
            printCard.style.setProperty('min-width', `${rect.width}px`, 'important');
            printCard.style.setProperty('max-width', `${rect.width}px`, 'important');
            printCard.style.setProperty('height', `${rect.height}px`, 'important');
            printCard.style.setProperty('min-height', `${rect.height}px`, 'important');
            printCard.style.setProperty('max-height', `${rect.height}px`, 'important');
            printCard.style.setProperty('box-sizing', 'border-box', 'important');
            printCard.style.setProperty('opacity', '1', 'important');
            printCard.style.setProperty('filter', 'none', 'important');
            printCard.style.setProperty('background', '#fff', 'important');
        });
    }

    function polishAddedNode(node) {
        if (!(node instanceof Element)) return;
        const sheet = node.matches('.family-print-sheet')
            ? node
            : node.querySelector('.family-print-sheet');
        if (!sheet) return;

        // buildPrintSheet() completes synchronously, then waits two animation frames before
        // calling print(). Polish on the next frame so all cloned cards are already present.
        requestAnimationFrame(() => preservePrintedCardGeometry(sheet));
    }

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) polishAddedNode(node);
        }
    });
    observer.observe(document.body, { childList: true, subtree: false });

    preservePrintedCardGeometry(document.querySelector('.family-print-sheet'));
})();
