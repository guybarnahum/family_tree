// Human-readable JSON import/export controls for the global family graph.
(() => {
    // The legacy inline page starts one /api/nodes request before injected scripts run.
    // If that request finishes after graph-view.js, redirect its initial centering hook
    // back into the graph renderer so the old full-tree response cannot win the race.
    const legacyCenterInitialTree = centerInitialTree;
    centerInitialTree = function graphAwareInitialCenter() {
        if (window.startFamilyGraph) {
            window.startFamilyGraph();
            return;
        }
        legacyCenterInitialTree();
    };

    // Start the canonical person-centric renderer immediately. A late legacy response
    // will call the override above and simply refresh the same graph view again.
    window.startFamilyGraph?.();

    const title = document.querySelector('h1');
    const titleCard = title?.parentElement;
    if (!titleCard || titleCard.dataset.importExportReady === 'true') return;
    titleCard.dataset.importExportReady = 'true';
    titleCard.classList.add('family-title-card');

    const style = document.createElement('style');
    style.textContent = `
        .family-title-card .family-import-export {
            display: flex;
            gap: 6px;
            margin-top: 7px;
            opacity: 0;
            max-height: 0;
            overflow: hidden;
            pointer-events: none;
            transform: translateY(-3px);
            transition: opacity 0.16s ease, max-height 0.16s ease, transform 0.16s ease;
        }

        .family-title-card:hover .family-import-export,
        .family-title-card:focus-within .family-import-export {
            opacity: 1;
            max-height: 32px;
            pointer-events: auto;
            transform: translateY(0);
        }

        .family-import-export button {
            border: 1px solid rgba(163, 177, 138, 0.45);
            background: rgba(255, 255, 255, 0.82);
            color: #344e41;
            border-radius: 999px;
            padding: 3px 9px;
            font-size: 10px;
            line-height: 1.3;
            cursor: pointer;
            transition: background-color 0.15s ease, border-color 0.15s ease;
        }

        .family-import-export button:hover,
        .family-import-export button:focus-visible {
            background: #fff;
            border-color: #588157;
            outline: none;
        }
    `;
    document.head.appendChild(style);

    const controls = document.createElement('div');
    controls.className = 'family-import-export';
    controls.setAttribute('aria-label', 'ייבוא וייצוא גרף המשפחה');
    controls.innerHTML = `
        <button type="button" data-tree-action="export" title="Export complete family graph">⇩ ייצוא</button>
        <button type="button" data-tree-action="import" title="Import complete family graph">⇧ ייבוא</button>
        <input type="file" accept="application/json,.json" data-tree-file hidden>
    `;
    titleCard.appendChild(controls);

    const fileInput = controls.querySelector('[data-tree-file]');

    function downloadJSON(documentValue) {
        const json = JSON.stringify(documentValue, null, 2) + '\n';
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `family-graph-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function exportGraph() {
        try {
            showStatus('מייצא...');
            const response = await fetch('/api/graph', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const graph = await response.json();
            graph.exportedAt = new Date().toISOString();
            downloadJSON(graph);
            showStatus('הייצוא הושלם');
        } catch (error) {
            console.error('Family graph export failed:', error);
            showStatus('שגיאה בייצוא');
        }
    }

    function validateImportEnvelope(value) {
        const isGraphV2 = value?.format === 'family-graph' && value?.version === 2 &&
            Array.isArray(value.people) && Array.isArray(value.relationships);
        const isLegacyV1 = value?.format === 'family-tree' && value?.version === 1 &&
            Array.isArray(value.people);

        if (!isGraphV2 && !isLegacyV1) {
            throw new Error('Unsupported family graph JSON format');
        }
        return value;
    }

    async function importFile(file) {
        try {
            const raw = await file.text();
            const documentValue = validateImportEnvelope(JSON.parse(raw));
            const relationshipCount = Array.isArray(documentValue.relationships)
                ? documentValue.relationships.length
                : 'legacy';

            const confirmed = confirm(
                `לייבא ${documentValue.people.length} אנשים?\n\n` +
                `Relationships: ${relationshipCount}\n` +
                'הייבוא יחליף את גרף המשפחה הגלובלי.'
            );
            if (!confirmed) return;

            showStatus('מייבא...');
            const response = await fetch('/api/graph', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(documentValue)
            });

            if (!response.ok) throw new Error(await response.text());

            dataSignature = '';
            await loadTree(null, true);
            showStatus('הייבוא הושלם');
        } catch (error) {
            console.error('Family graph import failed:', error);
            alert(`לא ניתן לייבא את הקובץ:\n${error.message}`);
            showStatus('שגיאה בייבוא');
        } finally {
            fileInput.value = '';
        }
    }

    controls.addEventListener('click', event => {
        const button = event.target.closest('[data-tree-action]');
        if (!button) return;

        if (button.dataset.treeAction === 'export') {
            exportGraph();
        } else if (button.dataset.treeAction === 'import') {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) importFile(file);
    });
})();
