// Print the exact currently visible family projection as a one-page landscape PDF.
// The live graph is never rerendered: cards and final connector SVG are cloned and scaled.
(() => {
    if (window.__familyPrintRefinement) return;
    window.__familyPrintRefinement = true;

    const controls = document.querySelector('.family-import-export');
    const canvas = document.getElementById('canvas');
    const cardsLayer = document.getElementById('cards-layer');
    const svgLayer = document.getElementById('svg-layer');
    const pageHeading = document.querySelector('h1');
    if (!controls || !canvas || !cardsLayer || !svgLayer) return;

    const PAGE_WIDTH = 11 * 96;
    const PAGE_HEIGHT = 8.5 * 96;
    const PAGE_MARGIN = 0.28 * 96;
    const TITLE_HEIGHT = 44;
    const TITLE_GAP = 12;
    const TITLE_BLOCK = TITLE_HEIGHT + TITLE_GAP;
    const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
    const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_MARGIN * 2 - TITLE_BLOCK;
    const GRAPH_PADDING = 22;
    const EMPTY_FIELD_PLACEHOLDERS = new Set(['', 'שם', 'תאריכים', 'תיאור']);

    const style = document.createElement('style');
    style.textContent = `
        .family-print-sheet { display: none; }

        @media (max-width: 768px), (hover: none) and (pointer: coarse) {
            .family-import-export button[data-tree-action="print"]::after {
                content: '⎙';
                font-size: 16px;
            }
        }

        @page { size: letter landscape; margin: 0; }

        @media print {
            html, body {
                width: 11in !important;
                height: 8.5in !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                background: #fff !important;
            }
            body > *:not(.family-print-sheet) { display: none !important; }

            .family-print-sheet {
                display: block !important;
                position: absolute !important;
                inset: 0 !important;
                width: 11in !important;
                height: 8.5in !important;
                overflow: hidden !important;
                background: #fff !important;
                direction: ltr !important;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }

            .family-print-title {
                position: absolute !important;
                left: auto !important;
                right: 32px !important;
                top: 12px !important;
                width: 650px !important;
                height: 58px !important;
                margin: 0 !important;
                color: #344e41 !important;
                font-family: "Frank Ruhl Libre", serif !important;
                font-size: 42px !important;
                font-weight: 700 !important;
                line-height: 54px !important;
                text-align: right !important;
                direction: rtl !important;
                white-space: nowrap !important;
            }

            .family-print-graph {
                position: absolute !important;
                transform-origin: 0 0 !important;
                direction: ltr !important;
            }

            .family-print-graph .absolute-card {
                display: flex !important;
                flex-direction: column !important;
                justify-content: center !important;
                align-items: stretch !important;
                box-sizing: border-box !important;
                padding: 8px 12px !important;
                transition: none !important;
                pointer-events: none !important;
                cursor: default !important;
                transform: translateX(-50%) !important;
                opacity: 1 !important;
                filter: none !important;
                background: #fff !important;
                background-image: none !important;
                mix-blend-mode: normal !important;
                box-shadow: none !important;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }
            .family-print-graph .absolute-card:hover { transform: translateX(-50%) !important; }

            .family-print-graph .absolute-card [data-field] {
                position: static !important;
                width: 100% !important;
                opacity: 1 !important;
                transform: none !important;
                text-align: center !important;
                background: transparent !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                pointer-events: none !important;
            }

            .family-print-graph .absolute-card .node-face-avatar {
                display: block !important;
                position: absolute !important;
                left: -14px !important;
                top: 50% !important;
                width: 40px !important;
                height: 40px !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                border: 2px solid #fff !important;
                border-radius: 999px !important;
                background: #eee9dd !important;
                box-shadow: none !important;
                z-index: 35 !important;
                pointer-events: none !important;
                transform: translateY(-50%) !important;
            }
            .family-print-graph .absolute-card.graph-root .node-face-avatar {
                left: -16px !important;
                width: 44px !important;
                height: 44px !important;
            }
            .family-print-graph .absolute-card .node-face-avatar img {
                position: absolute !important;
                display: block !important;
                max-width: none !important;
                max-height: none !important;
                margin: 0 !important;
                transform: none !important;
                transform-origin: 0 0 !important;
                filter: sepia(.82) saturate(.72) contrast(1.06) !important;
            }

            .family-print-graph [data-action],
            .family-print-graph .graph-frontier { display: none !important; }
        }
    `;
    document.head.appendChild(style);

    function centerName() {
        const rootCard = cardsLayer.querySelector('.absolute-card.graph-root[data-node-id]');
        const nameField = rootCard?.querySelector('[data-field="name"]');
        const value = nameField?.textContent?.trim() || '';
        if (!value || nameField?.classList.contains('default-node-text') || EMPTY_FIELD_PLACEHOLDERS.has(value)) return '';
        return value;
    }

    function familyTreeTitle() {
        const name = centerName();
        return name ? `עץ המשפחה של ${name}` : 'עץ המשפחה';
    }

    function syncOnlineTitle() {
        const value = familyTreeTitle();
        if (pageHeading && pageHeading.textContent !== value) pageHeading.textContent = value;
        if (document.title !== value) document.title = value;
    }

    window.addEventListener('family-graph-rendered', syncOnlineTitle);
    window.addEventListener('family-person-pane-saved', event => {
        if (event.detail?.field === 'name') syncOnlineTitle();
    });
    syncOnlineTitle();

    function addPrintButton() {
        let button = controls.querySelector('[data-tree-action="print"]');
        if (button) return button;
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.treeAction = 'print';
        button.title = 'Print current visible family graph / Save as PDF';
        button.textContent = '⎙ PDF';
        controls.insertBefore(button, controls.querySelector('[data-tree-file]') || null);
        return button;
    }

    const printButton = addPrintButton();

    function cardBounds() {
        const canvasRect = canvas.getBoundingClientRect();
        const cards = [...cardsLayer.querySelectorAll('.absolute-card[data-node-id]')];
        if (!cards.length) return null;

        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            left = Math.min(left, rect.left - canvasRect.left + canvas.scrollLeft);
            top = Math.min(top, rect.top - canvasRect.top + canvas.scrollTop);
            right = Math.max(right, rect.right - canvasRect.left + canvas.scrollLeft);
            bottom = Math.max(bottom, rect.bottom - canvasRect.top + canvas.scrollTop);
        }
        return { left, top, right, bottom };
    }

    function connectorBounds() {
        try {
            const box = svgLayer.getBBox();
            if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) ||
                !Number.isFinite(box.width) || !Number.isFinite(box.height) ||
                (box.width <= 0 && box.height <= 0)) return null;
            return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
        } catch (_) {
            return null;
        }
    }

    function graphBounds() {
        const cards = cardBounds();
        if (!cards) return null;
        const connectors = connectorBounds();
        const merged = connectors ? {
            left: Math.min(cards.left, connectors.left),
            top: Math.min(cards.top, connectors.top),
            right: Math.max(cards.right, connectors.right),
            bottom: Math.max(cards.bottom, connectors.bottom)
        } : cards;
        return {
            left: Math.max(0, merged.left - GRAPH_PADDING),
            top: Math.max(0, merged.top - GRAPH_PADDING),
            right: merged.right + GRAPH_PADDING,
            bottom: merged.bottom + GRAPH_PADDING
        };
    }

    function removeEmptyFields(clone) {
        clone.querySelectorAll('[data-field]').forEach(element => {
            const value = element.textContent.trim();
            if (element.classList.contains('default-node-text') || EMPTY_FIELD_PLACEHOLDERS.has(value)) element.remove();
        });
    }

    function preserveFieldSpacing(clone) {
        const name = clone.querySelector('[data-field="name"]');
        const dates = clone.querySelector('[data-field="dates"]');
        const description = clone.querySelector('[data-field="description"]');
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

    function cloneCards(bounds, graph) {
        for (const original of cardsLayer.querySelectorAll('.absolute-card[data-node-id]')) {
            const rect = original.getBoundingClientRect();
            const left = Number.parseFloat(original.style.left);
            const top = Number.parseFloat(original.style.top);
            if (!Number.isFinite(left) || !Number.isFinite(top) || rect.width <= 0 || rect.height <= 0) continue;

            const clone = original.cloneNode(true);
            clone.removeAttribute('id');
            clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
            clone.querySelectorAll('[contenteditable]').forEach(element => element.setAttribute('contenteditable', 'false'));
            clone.querySelectorAll('[data-action], .graph-frontier').forEach(element => element.remove());
            clone.classList.remove('graph-context', 'graph-spouse-parent', 'graph-spouse-ancestor-deep');
            removeEmptyFields(clone);
            preserveFieldSpacing(clone);

            for (const property of ['width', 'min-width', 'max-width']) {
                clone.style.setProperty(property, `${rect.width}px`, 'important');
            }
            for (const property of ['height', 'min-height', 'max-height']) {
                clone.style.setProperty(property, `${rect.height}px`, 'important');
            }
            clone.style.left = `${left - bounds.left}px`;
            clone.style.top = `${top - bounds.top}px`;
            graph.appendChild(clone);
        }
    }

    function cloneConnectors(bounds, width, height, graph) {
        const clone = svgLayer.cloneNode(true);
        clone.removeAttribute('id');
        clone.setAttribute('viewBox', `${bounds.left} ${bounds.top} ${width} ${height}`);
        clone.setAttribute('width', width);
        clone.setAttribute('height', height);
        clone.style.position = 'absolute';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;
        clone.style.overflow = 'visible';
        clone.style.pointerEvents = 'none';
        graph.appendChild(clone);
    }

    function buildPrintSheet() {
        document.querySelector('.family-print-sheet')?.remove();
        const bounds = graphBounds();
        if (!bounds) throw new Error('There is no visible family graph to print');

        const graphWidth = Math.max(1, bounds.right - bounds.left);
        const graphHeight = Math.max(1, bounds.bottom - bounds.top);
        const scale = Math.min(1, CONTENT_WIDTH / graphWidth, CONTENT_HEIGHT / graphHeight);
        const renderedWidth = graphWidth * scale;
        const renderedHeight = graphHeight * scale;
        const left = PAGE_MARGIN + (CONTENT_WIDTH - renderedWidth) / 2;
        const top = PAGE_MARGIN + TITLE_BLOCK + (CONTENT_HEIGHT - renderedHeight) / 2;

        const sheet = document.createElement('div');
        sheet.className = 'family-print-sheet';
        sheet.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h1');
        title.className = 'family-print-title';
        title.textContent = familyTreeTitle();
        sheet.appendChild(title);

        const graph = document.createElement('div');
        graph.className = 'family-print-graph';
        graph.style.width = `${graphWidth}px`;
        graph.style.height = `${graphHeight}px`;
        graph.style.left = `${left}px`;
        graph.style.top = `${top}px`;
        graph.style.transform = `scale(${scale})`;

        cloneConnectors(bounds, graphWidth, graphHeight, graph);
        cloneCards(bounds, graph);
        sheet.appendChild(graph);
        document.body.appendChild(sheet);
        return sheet;
    }

    let printSheet = null;
    let cleanupTimer = null;

    function cleanup() {
        clearTimeout(cleanupTimer);
        cleanupTimer = null;
        printSheet?.remove();
        printSheet = null;
        printButton.disabled = false;
    }

    async function printVisibleGraph() {
        if (printButton.disabled) return;
        try {
            printButton.disabled = true;
            showStatus('מכין PDF...');
            printSheet = buildPrintSheet();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            window.print();
            showStatus('בחר Save as PDF');
            // Safari does not consistently emit afterprint after a PDF save.
            cleanupTimer = setTimeout(cleanup, 1500);
        } catch (error) {
            console.error('Unable to print visible family graph:', error);
            showStatus('שגיאה בהדפסה');
            cleanup();
        }
    }

    controls.addEventListener('click', event => {
        const button = event.target.closest('[data-tree-action="print"]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        void printVisibleGraph();
    });

    window.addEventListener('afterprint', cleanup);
})();
