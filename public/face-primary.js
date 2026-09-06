// Slice F preferred-face control. Preference lives on Person.metadata.primaryFaceId; the
// selected face must already be assigned to that person.
(() => {
    if (window.__familyFacePrimaryInstalled) return;
    window.__familyFacePrimaryInstalled = true;

    const modal = document.getElementById('person-media-modal');
    const editor = modal?.querySelector('.face-editor');
    const overlay = modal?.querySelector('.face-overlay');
    const personSelect = modal?.querySelector('.face-person-select');
    const deleteButton = modal?.querySelector('.face-delete');
    if (!modal || !editor || !overlay || !personSelect || !deleteButton) return;

    let preferredByPerson = new Map();
    let refreshSerial = 0;
    let retryTimers = [];

    const style = document.createElement('style');
    style.textContent = `
        .face-primary-button {
            flex: 0 0 auto;
            border: 1px solid rgba(88,129,87,.25);
            border-radius: 999px;
            background: rgba(163,177,138,.10);
            color: #4f7650;
            padding: 8px 10px;
            font: 600 10px/1 Inter,sans-serif;
            white-space: nowrap;
            cursor: pointer;
        }
        .face-primary-button:hover:not(:disabled),
        .face-primary-button:focus-visible:not(:disabled) {
            background: rgba(163,177,138,.20);
            outline: none;
        }
        .face-primary-button.is-primary {
            background: rgba(88,129,87,.13);
            border-color: rgba(88,129,87,.35);
            color: #3f6843;
            cursor: default;
        }
        .face-primary-button:disabled { opacity: .72; }
        @media (max-width: 640px) {
            .face-primary-button { align-self: flex-start; }
        }
    `;
    document.head.appendChild(style);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'face-primary-button';
    button.hidden = true;
    deleteButton.before(button);

    function selectedFaceId() {
        return overlay.querySelector('.face-box.selected')?.dataset.faceId || null;
    }

    function selectedPersonId() {
        return personSelect.value || null;
    }

    function syncButton() {
        const faceId = selectedFaceId();
        const personId = selectedPersonId();
        if (!editor.classList.contains('open') || !faceId || !personId) {
            button.hidden = true;
            return;
        }

        button.hidden = false;
        const preferred = preferredByPerson.get(personId);
        const explicitlyPrimary = preferred?.explicit && preferred?.face?.id === faceId;
        button.classList.toggle('is-primary', !!explicitlyPrimary);
        button.disabled = !!explicitlyPrimary;
        button.textContent = explicitlyPrimary ? 'תמונה ראשית ✓' : 'קבע כתמונה ראשית';
    }

    async function refreshPreferred({ notify = false } = {}) {
        const serial = ++refreshSerial;
        try {
            const response = await fetch('/api/faces/preferred', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            if (serial !== refreshSerial) return;
            preferredByPerson = new Map(
                (Array.isArray(payload.items) ? payload.items : [])
                    .map(item => [item.personId, item])
            );
            syncButton();
            if (notify) {
                window.dispatchEvent(new CustomEvent('family-faces-changed'));
            }
        } catch (error) {
            console.warn('Unable to refresh preferred face state:', error);
        }
    }

    function scheduleFaceRefresh() {
        retryTimers.forEach(clearTimeout);
        retryTimers = [320, 1200].map(delay => setTimeout(() => {
            void refreshPreferred({ notify: true });
        }, delay));
    }

    button.addEventListener('click', async () => {
        const faceId = selectedFaceId();
        const personId = selectedPersonId();
        if (!faceId || !personId || button.disabled) return;

        button.disabled = true;
        try {
            const response = await fetch(`/api/faces/${encodeURIComponent(faceId)}/preferred`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            preferredByPerson.set(personId, {
                personId,
                explicit: true,
                face: payload.face || { id: faceId }
            });
            syncButton();
            window.dispatchEvent(new CustomEvent('family-face-primary-changed', {
                detail: { personId, faceId }
            }));
            showStatus('התמונה הראשית נשמרה');
        } catch (error) {
            button.disabled = false;
            console.error('Unable to set preferred face:', error);
            showStatus('שגיאה בשמירת התמונה הראשית');
        }
    });

    // These operations are persisted by face-tagging.js. Refresh shortly afterward so the
    // graph's automatic fallback face and crop follow assignment/move/delete operations.
    personSelect.addEventListener('change', () => {
        button.disabled = true;
        scheduleFaceRefresh();
    });
    overlay.addEventListener('pointerup', scheduleFaceRefresh);
    deleteButton.addEventListener('click', scheduleFaceRefresh);

    new MutationObserver(syncButton).observe(overlay, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    new MutationObserver(syncButton).observe(personSelect, {
        childList: true,
        subtree: true,
        attributes: true
    });
    new MutationObserver(() => {
        if (modal.classList.contains('open')) void refreshPreferred();
        else button.hidden = true;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });

    if (modal.classList.contains('open')) void refreshPreferred();
})();
