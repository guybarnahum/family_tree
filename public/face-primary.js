// Preferred-face control. Preference lives on Person.metadata.primaryFaceId; the selected face
// must already be assigned to that person.
(() => {
    if (window.__familyFacePrimaryInstalled) return;
    window.__familyFacePrimaryInstalled = true;

    const Api = window.FamilyApi;
    const modal = document.getElementById('person-media-modal');
    const deleteButton = modal?.querySelector('.face-delete');
    if (!Api || !modal || !deleteButton) return;

    let preferredByPerson = new Map();
    let refreshSerial = 0;
    let activeMediaId = null;
    let activeFaceId = null;
    let activePersonId = null;
    let editorOpen = false;

    const style = document.createElement('style');
    style.textContent = `
        .face-primary-button {
            flex:0 0 auto; border:1px solid rgba(88,129,87,.25); border-radius:999px;
            background:rgba(163,177,138,.10); color:#4f7650; padding:8px 10px;
            font:600 10px/1 Inter,sans-serif; white-space:nowrap; cursor:pointer;
        }
        .face-primary-button:hover:not(:disabled),.face-primary-button:focus-visible:not(:disabled) {
            background:rgba(163,177,138,.20); outline:none;
        }
        .face-primary-button.is-primary {
            background:rgba(88,129,87,.13); border-color:rgba(88,129,87,.35); color:#3f6843; cursor:default;
        }
        .face-primary-button:disabled { opacity:.72; }
        @media (max-width:640px) { .face-primary-button { align-self:flex-start; } }
    `;
    document.head.appendChild(style);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'face-primary-button';
    button.hidden = true;
    deleteButton.before(button);

    function syncButton() {
        if (!editorOpen || !activeFaceId || !activePersonId) {
            button.hidden = true;
            return;
        }
        button.hidden = false;
        const preferred = preferredByPerson.get(activePersonId);
        const explicitlyPrimary = preferred?.explicit && preferred?.face?.id === activeFaceId;
        button.classList.toggle('is-primary', !!explicitlyPrimary);
        button.disabled = !!explicitlyPrimary;
        button.textContent = explicitlyPrimary ? 'תמונה ראשית ✓' : 'קבע כתמונה ראשית';
    }

    async function refreshPreferred({ notify = false } = {}) {
        const serial = ++refreshSerial;
        try {
            const response = await Api.request('/api/faces/preferred', { cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            const payload = await response.json();
            if (serial !== refreshSerial) return;
            preferredByPerson = new Map(
                (Array.isArray(payload.items) ? payload.items : []).map(item => [item.personId, item])
            );
            syncButton();
            if (notify) window.dispatchEvent(new CustomEvent('family-faces-changed'));
        } catch (error) {
            console.warn('Unable to refresh preferred face state:', error);
        }
    }

    button.addEventListener('click', async () => {
        const faceId = activeFaceId;
        const personId = activePersonId;
        if (!faceId || !personId || button.disabled) return;
        button.disabled = true;
        try {
            const response = await Api.request(`/api/faces/${encodeURIComponent(faceId)}/preferred`, {
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

    window.addEventListener('family-face-editor-state', event => {
        const detail = event.detail || {};
        const nextMediaId = detail.mediaId || null;
        const mediaChanged = nextMediaId !== activeMediaId;
        activeMediaId = nextMediaId;
        activeFaceId = detail.faceId || null;
        activePersonId = detail.personId || null;
        editorOpen = !!detail.open;
        syncButton();
        if (activeMediaId && mediaChanged) void refreshPreferred();
    });

    window.addEventListener('family-api-mutation', event => {
        const detail = event.detail || {};
        if (detail.scope === 'faces' && !String(detail.path || '').endsWith('/preferred')) {
            void refreshPreferred({ notify: true });
        }
    });
})();