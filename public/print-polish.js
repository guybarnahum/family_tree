// Print-only visual corrections layered around print-refinement.js.
// Preserve the exact measured card geometry used to draw connectors while allowing
// placeholder fields to be omitted from the PDF clone, and normalize presentation.
(() => {
    if (window.__familyPrintPolish) return;
    window.__familyPrintPolish = true;

    const cardsLayer = document.getElementById('cards-layer');
    if (!cardsLayer) return;

    const style = document.createElement('style');
    style.textContent = `
        @media print {
            html body .family-print-sheet .family-print-title {
                font-family: "Frank Ruhl Libre", serif !important;
                font-size: 42px !important;
                font-weight: 700 !important;
                line-height: 54px !important;
                text-align: right !important;
                direction: rtl !important;
            }

            html body .family-print-sheet .family-print-graph .absolute-card {
                opacity: 1 !important;
                filter: none !important;
                background: #fff !important;
                background-color: #fff !important;
                background-image: none !important;
                mix-blend-mode: normal !important;
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

    function polishTitle(sheet) {
        const title = sheet?.querySelector('.family-print-title');
        if (!title) return;

        // Inline !important values intentionally beat the print engine's base CSS so the
        // PDF title always mirrors the website's large, right-aligned Hebrew heading.
        title.style.setProperty('left', 'auto', 'important');
        title.style.setProperty('right', '32px', 'important');
        title.style.setProperty('top', '12px', 'important');
        title.style.setProperty('width', '650px', 'important');
        title.style.setProperty('height', '58px', 'important');
        title.style.setProperty('margin', '0', 'important');
        title.style.setProperty('font-family', '"Frank Ruhl Libre", serif', 'important');
        title.style.setProperty('font-size', '42px', 'important');
        title.style.setProperty('font-weight', '700', 'important');
        title.style.setProperty('line-height', '54px', 'important');
        title.style.setProperty('text-align', 'right', 'important');
        title.style.setProperty('direction', 'rtl', 'important');
        title.style.setProperty('color', '#344e41', 'important');
        title.style.setProperty('white-space', 'nowrap', 'important');
    }

    function polishPrintedCard(printCard) {
        const original = originalCardFor(printCard);
        if (!original) return;

        const rect = original.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
            rect.width <= 0 || rect.height <= 0) return;

        // Contextual dimming is useful on-screen, but the PDF should use one consistent
        // white card treatment. Removing the classes also prevents later print CSS from
        // reintroducing opacity/filter differences after this refinement has run.
        printCard.classList.remove(
            'graph-context',
            'graph-spouse-parent',
            'graph-spouse-ancestor-deep'
        );

        // print-refinement removes placeholder elements from the clone. Preserve the
        // original outer rectangle so the SVG endpoints still meet the exact card center.
        printCard.style.setProperty('width', `${rect.width}px`, 'important');
        printCard.style.setProperty('min-width', `${rect.width}px`, 'important');
        printCard.style.setProperty('max-width', `${rect.width}px`, 'important');
        printCard.style.setProperty('height', `${rect.height}px`, 'important');
        printCard.style.setProperty('min-height', `${rect.height}px`, 'important');
        printCard.style.setProperty('max-height', `${rect.height}px`, 'important');
        printCard.style.setProperty('box-sizing', 'border-box', 'important');

        printCard.style.setProperty('display', 'flex', 'important');
        printCard.style.setProperty('flex-direction', 'column', 'important');
        printCard.style.setProperty('justify-content', 'center', 'important');
        printCard.style.setProperty('align-items', 'stretch', 'important');
        printCard.style.setProperty('padding', '8px 12px', 'important');
        printCard.style.setProperty('opacity', '1', 'important');
        printCard.style.setProperty('filter', 'none', 'important');
        printCard.style.setProperty('background', '#fff', 'important');
        printCard.style.setProperty('background-color', '#fff', 'important');
        printCard.style.setProperty('background-image', 'none', 'important');
        printCard.style.setProperty('mix-blend-mode', 'normal', 'important');
        printCard.style.setProperty('box-shadow', '0 2px 7px rgba(52, 78, 65, 0.12)', 'important');

        const fields = [...printCard.querySelectorAll('[data-field]')];
        fields.forEach(field => {
            field.style.setProperty('position', 'static', 'important');
            field.style.setProperty('width', '100%', 'important');
            field.style.setProperty('opacity', '1', 'important');
            field.style.setProperty('transform', 'none', 'important');
            field.style.setProperty('text-align', 'center', 'important');
            field.style.setProperty('background', 'transparent', 'important');
            field.style.setProperty('margin-left', '0', 'important');
            field.style.setProperty('margin-right', '0', 'important');
        });

        const name = printCard.querySelector('[data-field="name"]');
        const dates = printCard.querySelector('[data-field="dates"]');
        const description = printCard.querySelector('[data-field="description"]');
        if (name) {
            name.style.setProperty('margin-top', '0', 'important');
            name.style.setProperty('margin-bottom', dates || description ? '3px' : '0', 'important');
        }
        if (dates) {
            dates.style.setProperty('margin-top', '0', 'important');
            dates.style.setProperty('margin-bottom', description ? '3px' : '0', 'important');
        }
        if (description) {
            description.style.setProperty('margin-top', '0', 'important');
            description.style.setProperty('margin-bottom', '0', 'important');
        }
    }

    function preservePrintedPresentation(sheet) {
        if (!sheet) return;
        polishTitle(sheet);
        sheet.querySelectorAll('.family-print-graph .absolute-card[data-node-id]')
            .forEach(polishPrintedCard);
    }

    function polishAddedNode(node) {
        if (!(node instanceof Element)) return;
        const sheet = node.matches('.family-print-sheet')
            ? node
            : node.querySelector('.family-print-sheet');
        if (!sheet) return;

        // buildPrintSheet() completes synchronously, then waits two animation frames before
        // calling print(). Polish on the next frame after all cloned cards are present.
        requestAnimationFrame(() => preservePrintedPresentation(sheet));
    }

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) polishAddedNode(node);
        }
    });
    observer.observe(document.body, { childList: true, subtree: false });

    preservePrintedPresentation(document.querySelector('.family-print-sheet'));
})();
