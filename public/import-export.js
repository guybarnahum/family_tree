// Human-readable JSON import/export controls for the title card.
(() => {
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
    controls.setAttribute('aria-label', 'ייבוא וייצוא עץ המשפחה');
    controls.innerHTML = `
        <button type="button" data-tree-action="export" title="Export family tree">⇩ ייצוא</button>
        <button type="button" data-tree-action="import" title="Import family tree">⇧ ייבוא</button>
        <input type="file" accept="application/json,.json" data-tree-file hidden>
    `;
    titleCard.appendChild(controls);

    const fileInput = controls.querySelector('[data-tree-file]');

    function clean(value) {
        return value === undefined ? null : value;
    }

    function humanTreeDocument(nodes) {
        return {
            format: 'family-tree',
            version: 1,
            exportedAt: new Date().toISOString(),
            people: nodes.map(node => ({
                id: node.id,
                name: clean(node.name),
                dates: clean(node.dates),
                description: clean(node.description),
                parentId: clean(node.parent_id),
                spouseId: clean(node.spouse_id)
            }))
        };
    }

    function downloadJSON(documentValue) {
        const json = JSON.stringify(documentValue, null, 2) + '\n';
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `family-tree-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function exportTree() {
        try {
            showStatus('מייצא...');
            const response = await fetch('/api/nodes', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const nodes = await response.json();
            downloadJSON(humanTreeDocument(nodes));
            showStatus('הייצוא הושלם');
        } catch (error) {
            console.error('Family tree export failed:', error);
            showStatus('שגיאה בייצוא');
        }
    }

    function normalizeImportDocument(value) {
        if (!value || value.format !== 'family-tree' || value.version !== 1 || !Array.isArray(value.people)) {
            throw new Error('Unsupported family-tree JSON format');
        }

        return {
            format: 'family-tree',
            version: 1,
            people: value.people.map(person => ({
                id: person.id,
                name: person.name ?? null,
                dates: person.dates ?? null,
                description: person.description ?? null,
                parentId: person.parentId ?? null,
                spouseId: person.spouseId ?? null
            }))
        };
    }

    async function importFile(file) {
        try {
            const raw = await file.text();
            const documentValue = normalizeImportDocument(JSON.parse(raw));

            const confirmed = confirm(
                `לייבא ${documentValue.people.length} אנשים?\n\n` +
                'הייבוא יחליף את עץ המשפחה הנוכחי.'
            );
            if (!confirmed) return;

            showStatus('מייבא...');
            const response = await fetch('/api/tree', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(documentValue)
            });

            if (!response.ok) throw new Error(await response.text());

            dataSignature = '';
            await loadTree(null, true);
            showStatus('הייבוא הושלם');
        } catch (error) {
            console.error('Family tree import failed:', error);
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
            exportTree();
        } else if (button.dataset.treeAction === 'import') {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) importFile(file);
    });
})();
