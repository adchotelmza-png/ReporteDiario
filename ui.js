/* =====================================================================
   ui.js — Interfaz de usuario, accesibilidad y alarmas
   ===================================================================== */
import { FirebaseService, PERMISOS } from './firebase-service.js';
import { AdminPanel } from './admin.js';

const can = p => FirebaseService.can(p);
const $= id => document.getElementById(id); const $$ = s => document.querySelectorAll(s);
const toLocalISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const escapeHTML = str => !str ? '' : String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const formatDate = d => (!d || !d.toLocaleDateString) ? 'Fecha Inválida' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatFullTimestamp = d => (!d || !d.toLocaleString) ? '' : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const WHATSAPP_ICON = `<svg class="icon" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7.973 1.127l-2.76-2.76a1 1 0 00-1.53.136l-.37.986 1.83 4.956 4.956 1.83.986-.37a1 1 0 00.136-1.53l-2.76-2.76z" clip-rule="evenodd"></path></svg>`;

const itemsPerPage = 20;
let currentPage = 1, filteredNovedades = [], currentNovedades = [], currentAlarms = [];
const allNovedadesMap = new Map(), selectedNovedadIds = new Set(), triggeredAlarmsCache = new Set();
let triggeredCacheDate = '', alarmInterval = null;

/* ---- Mejoras: atrasadas, resumen y borrador ---- */
let agingInterval = null, staleOnly = false;
const DRAFT_KEY = 'registro-diario:borrador-novedad';
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/* Horas que una novedad "Pendiente" puede estar abierta antes de marcarse como atrasada (editable) */
const STALE_HOURS = { Urgente: 4, Alta: 12, Media: 24, Baja: 48 };
const estadoDe = n => n.estado === 'Completado' ? 'Completado' : 'Pendiente';   // los registros viejos "En curso" cuentan como Pendiente
const novedadDate = n => n.timestamp?.toDate ? n.timestamp.toDate() : null;
const isStale = n => {
    if (n.estado === 'Completado') return false;
    const d = novedadDate(n);
    return !!d && (Date.now() - d.getTime()) / 36e5 >= (STALE_HOURS[n.prioridad] ?? 24);
};
const formatAge = ms => { const h = Math.floor(ms / 36e5); return h < 48 ? `${Math.max(h, 1)} h` : `${Math.floor(h / 24)} d`; };

const multiselectOptions = ['Mantenimiento', 'HSKP', 'Front', 'Jefe Recepción', 'Parking', 'Gerencia', 'Reservas', 'Administración', 'Spa', 'Restaurante'];
const LOGIN_ERRORS = {
    'app/invalid-credential': 'Usuario o clave incorrectos.',
    'permission-denied': 'Sin permiso en Firestore: revisa las reglas de seguridad (ver instrucciones).',
    'auth/invalid-credential': 'Clave o email incorrectos.', 'auth/wrong-password': 'Clave o email incorrectos.',
    'auth/user-not-found': 'Clave o email incorrectos.', 'auth/invalid-email': 'El email no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu internet.'
};

function abrirModalDetalleMovil(n) {
    if (!n) return;
    const d = n.timestamp?.toDate ? n.timestamp.toDate() : new Date();
    const priorClass = { 'Urgente':'badge-urgente', 'Alta':'badge-alta', 'Media':'badge-media' }[n.prioridad] || 'badge-baja';

    $('mobile-detail-content').innerHTML = `
        <div><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Novedad:</strong><br><span style="font-size:1.05rem; font-weight:bold;">${escapeHTML(n.novedad)}</span></div>
        <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; border-top: 1px solid rgba(128,128,128,0.1); padding-top: 0.5rem;">
            <div><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Fecha:</strong><br>${formatDate(d)} ${d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</div>
            <div style="text-align:right;"><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Turno:</strong><br>${escapeHTML(n.turno)}</div>
        </div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(128,128,128,0.1); padding-top: 0.5rem;">
            <div><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Prioridad:</strong><br><span class="badge ${priorClass}" style="margin-top:2px; display:inline-block;">${escapeHTML(n.prioridad)}</span></div>
            <div style="text-align:right;"><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Estado:</strong><br><strong style="color:${n.estado==='Completado'?'#10b981':'#f59e0b'}">${escapeHTML(estadoDe(n))}</strong></div>
        </div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(128,128,128,0.1); padding-top: 0.5rem;">
            <div><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Área / Elemento:</strong><br>${escapeHTML(n.areaElemento || '-')}</div>
            <div style="text-align:right;"><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Habitación:</strong><br>${escapeHTML(n.habitacion || '-')}</div>
        </div>
        <div style="border-top: 1px solid rgba(128,128,128,0.1); padding-top: 0.5rem;">
            <div><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Nº Reserva:</strong> ${escapeHTML(n.nReserva || '-')}</div>
            <div style="margin-top: 0.2rem;"><strong style="color:var(--color-texto-secundario); font-size:0.8rem; text-transform:uppercase;">Notificado a:</strong> ${escapeHTML(n.notificadoA || '-')}</div>
        </div>
    `;

    const btnEstado = $('mobile-btn-estado');
    btnEstado.dataset.id = n.id;
    btnEstado.textContent = n.estado === 'Completado' ? 'Marcar Pendiente' : 'Marcar Completado';
    btnEstado.style.backgroundColor = btnEstado.style.borderColor = btnEstado.style.color = '';
    if(n.estado === 'Completado') {
        btnEstado.className = 'button button-orange';
    } else {
        btnEstado.className = 'button button-secondary';
        btnEstado.style.backgroundColor = '#10b981';
        btnEstado.style.borderColor = '#10b981';
        btnEstado.style.color = 'white';
    }
    
    const btnRespuestas = $('mobile-btn-respuestas');
    btnRespuestas.dataset.id = n.id;
    btnRespuestas.innerHTML = `Respuestas (${n.comentarios?.length || 0})`;
    
    $('mobile-btn-editar').dataset.id = n.id;
    $('mobile-btn-borrar').dataset.id = n.id;

    UI.openModal($('mobile-detail-modal'));
}

export const UI = {
    init() {
        this.setupAccessibility();
        this.setupDatePickers();
        this.setupEventListeners();
        this.populateMultiselect();
        AdminPanel.init(this);
    },

    /* ---------- Calendario nativo: se abre al hacer clic en cualquier parte del campo ---------- */
    setupDatePickers() {
        $$('input[type="date"]').forEach(inp => inp.addEventListener('click', e => {
            if (typeof inp.showPicker !== 'function' || inp.disabled || inp.readOnly) return;
            if (e.clientX > inp.getBoundingClientRect().right - 40) return; /* el icono nativo ya lo abre */
            try { inp.showPicker(); } catch (_) { /* el navegador no lo permite: queda el icono nativo */ }
        }));
    },

    /* ---------- Resumen rápido (clickeable) ---------- */
    renderSummary() {
        const box = $('summary-bar');
        if (!box) return;
        const hoy = toLocalISODate(new Date());
        let enCurso = 0, urgentes = 0, atrasadas = 0, deHoy = 0;
        currentNovedades.forEach(n => {
            if (toLocalISODate(novedadDate(n) || new Date()) === hoy) deHoy++;
            if (n.estado === 'Completado') return;
            enCurso++;
            if (n.prioridad === 'Urgente') urgentes++;
            if (isStale(n)) atrasadas++;
        });
        const desde = $('filter-fecha-desde').value, hasta = $('filter-fecha-hasta').value;
        const estado = $('filter-estado').value, prio = $('filter-prioridad').value;
        const sinFechas = !desde && !hasta;
        const chips = [
            { k: 'hoy', label: 'Hoy', n: deHoy, tone: '', active: desde === hoy && hasta === hoy && !estado && !prio && !staleOnly },
            { k: 'encurso', label: 'Pendientes', n: enCurso, tone: '', active: estado === 'Pendiente' && !prio && !staleOnly && sinFechas },
            { k: 'urgentes', label: 'Urgentes pendientes', n: urgentes, tone: 'danger', active: estado === 'Pendiente' && prio === 'Urgente' && !staleOnly && sinFechas },
            { k: 'atrasadas', label: 'Atrasadas', n: atrasadas, tone: 'warn', active: staleOnly }
        ];
        box.innerHTML = chips.map(c => `
            <button type="button" class="summary-chip ${c.tone}${c.n > 0 ? ' has-items' : ''}${c.active ? ' is-active' : ''}" data-kpi="${c.k}" aria-pressed="${c.active}">
                <span class="summary-count">${c.n}</span><span class="summary-label">${c.label}</span>
            </button>`).join('');
    },

    toggleSummaryFilter(k) {
        const box = $('summary-bar');
        const eraActivo = box.querySelector(`[data-kpi="${k}"]`)?.classList.contains('is-active');
        ['estado', 'prioridad', 'fecha-desde', 'fecha-hasta'].forEach(id => $(`filter-${id}`).value = '');
        staleOnly = false;
        if (!eraActivo) {
            const hoy = toLocalISODate(new Date());
            if (k === 'hoy') { $('filter-fecha-desde').value = $('filter-fecha-hasta').value = hoy; }
            else {
                $('filter-estado').value = 'Pendiente';
                if (k === 'urgentes') $('filter-prioridad').value = 'Urgente';
                if (k === 'atrasadas') staleOnly = true;
            }
        }
        this.applyFiltersAndRender();
        box.querySelector(`[data-kpi="${k}"]`)?.focus();
    },

    /* ---------- Borrador de la novedad nueva (no se pierde si se cierra o se recarga) ---------- */
    saveDraft() {
        if ($('novedad-id').value || $('novedad-modal').classList.contains('hidden')) return;
        const data = {
            prioridad: $('prioridad').value, nReserva: $('nReserva').value, habitacion: $('habitacion').value,
            areaElemento: $('areaElemento').value, novedad: $('novedad').value,
            notificadoA: Array.from($$('.multiselect-option:checked')).map(cb => cb.value)
        };
        if (!(data.nReserva.trim() || data.habitacion.trim() || data.areaElemento.trim() || data.novedad.trim() || data.notificadoA.length)) return this.clearDraft();
        data.savedAt = Date.now();
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (_) { /* almacenamiento no disponible */ }
    },

    restoreDraft() {
        let d = null;
        try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { d = null; }
        if (!d || Date.now() - (d.savedAt || 0) > DRAFT_MAX_AGE_MS) { this.clearDraft(); return false; }
        $('prioridad').value = d.prioridad || 'Media'; $('nReserva').value = d.nReserva || '';
        $('habitacion').value = d.habitacion || ''; $('areaElemento').value = d.areaElemento || '';
        $('novedad').value = d.novedad || '';
        const sel = Array.isArray(d.notificadoA) ? d.notificadoA : [];
        $$('.multiselect-option').forEach(cb => cb.checked = sel.includes(cb.value));
        this.updateMultiselectLabel();
        $('draft-notice').classList.remove('hidden');
        return true;
    },

    clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* nada que borrar */ } },

    setupAccessibility() {
        $$('.modal-overlay').forEach(m => { m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); }); document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; const abiertos = $$
('.modal-overlay:not(.hidden)');
            if (abiertos.length) this.closeModal(abiertos[abiertos.length - 1]);
        });
    },

    openModal(modal, focusId = null) {
        modal._returnFocus = document.activeElement;
        modal.classList.remove('hidden');
        if (focusId) setTimeout(() => $(focusId)?.focus(), 100);
    },

    closeModal(modal) {
        modal.classList.add('hidden');
        modal._returnFocus?.focus?.();
        modal._returnFocus = null;
    },

    showMessage(title, content) {
        $('modal-title').textContent = title;
        $('modal-content').textContent = content;
        this.openModal($('message-modal')); },      setupEventListeners() { $$('.btn-cerrar-modal').forEach(btn => btn.addEventListener('click', e => {
            const modal = e.currentTarget.closest('.modal-overlay');
            if (modal) this.closeModal(modal);
        }));

        $('login-button').addEventListener('click', () => this.handleLogin());$('logout-button').addEventListener('click', async () => { this.clearDraft(); await FirebaseService.logout(); this.onAuthError(); });
        ['login-usuario', 'login-password'].forEach(id => $(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this.handleLogin(); }
        }));

        $('open-add-modal-btn').addEventListener('click', () => this.openNovedadModal());
        $('novedad-form').addEventListener('submit', e => this.handleNovedadSubmit(e));$('prioridad').addEventListener('change', e => this.actualizarColorPrioridad(e.target));

        $('clear-filters-btn').addEventListener('click', () => {
            staleOnly = false;
            ['turno', 'fecha-desde', 'fecha-hasta', 'prioridad', 'estado', 'text'].forEach(id => $(`filter-${id}`).value = '');
            this.applyFiltersAndRender();
        });

        ['filter-turno', 'filter-fecha-desde', 'filter-fecha-hasta', 'filter-prioridad', 'filter-estado'].forEach(id =>
            $(id).addEventListener('change', () => { if (id !== 'filter-turno') staleOnly = false; this.applyFiltersAndRender(); }));

        /* Resumen clickeable + borrador del formulario */
        $('summary-bar').addEventListener('click', e => {
            const chip = e.target.closest('[data-kpi]');
            if (chip) this.toggleSummaryFilter(chip.dataset.kpi);
        });
        ['input', 'change'].forEach(ev => $('novedad-form').addEventListener(ev, () => this.saveDraft()));
        $('discard-draft-btn').addEventListener('click', () => {
            this.clearDraft();
            $('novedad-form').reset();
            this.resetMultiselect();
            this.actualizarColorPrioridad($('prioridad'));
            $('draft-notice').classList.add('hidden');
            $('areaElemento').focus();
        });

        const filtrarConRetardo = debounce(() => this.applyFiltersAndRender(), 300);
        $('filter-text').addEventListener('input', () => filtrarConRetardo());

        $('novedades-log').addEventListener('click', e => this.handleTableClick(e));
        $('novedades-log').addEventListener('change', e => this.handleTableChange(e));          const theadEl = document.querySelector('.novedades-table thead'); if (theadEl) { theadEl.addEventListener('change', e => { if (e.target.id === 'select-all-filtered-checkbox') { const pageData = filteredNovedades.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage); const isChecked = e.target.checked; pageData.forEach(n => { if (isChecked) selectedNovedadIds.add(n.id); else selectedNovedadIds.delete(n.id); }); $$('.novedad-checkbox').forEach(cb => cb.checked = isChecked);
                    this.updateWhatsappButton();
                }
            });
        }

        $('mobile-btn-estado').addEventListener('click', e => this.handleMobileEstado(e));$('mobile-btn-respuestas').addEventListener('click', e => {
            this.closeModal($('mobile-detail-modal'));
            this.openComments(allNovedadesMap.get(e.currentTarget.dataset.id));
        });
        $('mobile-btn-editar').addEventListener('click', e => {
            this.closeModal($('mobile-detail-modal'));
            const n = allNovedadesMap.get(e.currentTarget.dataset.id);
            if (n) this.openNovedadModal(n);
        });
        $('mobile-btn-borrar').addEventListener('click', e => {
            this.closeModal($('mobile-detail-modal'));$('confirm-delete-btn').dataset.id = e.currentTarget.dataset.id;
            this.openModal($('confirm-modal'));
        });

        $('confirm-delete-btn').addEventListener('click', async e => {
            if (!can('borrar')) return this.closeModal($('confirm-modal'));
            const id = e.currentTarget.dataset.id;
            try {
                await FirebaseService.deleteNovedad(id);
                selectedNovedadIds.delete(id);
                this.updateWhatsappButton();
            } catch (err) { this.showMessage('Error', 'No se pudo eliminar: ' + err.message); }
            finally { this.closeModal($('confirm-modal')); }
        });

        $('add-comment-form').addEventListener('submit', e => this.handleCommentSubmit(e));$('export-button').addEventListener('click', () => this.exportExcel());
        $('export-pdf-button').addEventListener('click', () => this.exportPDF());$('whatsapp-copy-button').addEventListener('click', () => this.copyWhatsapp());

        $('delete-all-btn').addEventListener('click', () => {
            if (!can('borrarTodo')) return;
            this.openModal($('delete-all-modal'), 'confirm-delete-all-btn');
        });
        $('confirm-delete-all-btn').addEventListener('click', () => this.handleDeleteAll());

        $('open-reminder-modal-btn').addEventListener('click', () => {$('reminder-date').value = toLocalISODate(new Date());
            this.syncReminderFields();
            this.openModal($('reminder-modal'));
        });
        $('reminder-type').addEventListener('change', () => this.syncReminderFields());
        $('reminder-form').addEventListener('submit', e => this.handleReminderSubmit(e));$('active-alarms-list').addEventListener('click', async e => {
            const btn = e.target.closest('.delete-alarm-btn');
            if (!btn || !can('alarmas')) return;
            try { await FirebaseService.deleteAlarm(btn.dataset.id); }
            catch (err) { this.showMessage('Error', 'No se pudo eliminar la alarma: ' + err.message); }
        });

        const msContainer = $('multiselect-dropdown-container');$('multiselect-button').addEventListener('click', () => msContainer.classList.toggle('hidden'));
        document.addEventListener('click', e => { if (!e.target.closest('.relative')) msContainer.classList.add('hidden'); });
        $('multiselect-search').addEventListener('input', e => {
            const v = e.target.value.toLowerCase();
            msContainer.querySelectorAll('.multiselect-option-label:not(:first-child)').forEach(el =>
                el.classList.toggle('hidden', !el.textContent.toLowerCase().includes(v)));
        });
    },

    async handleLogin() {
        const btn = $('login-button'), errEl = $('login-error');
        if (btn.disabled) return;
        const usuario = $('login-usuario').value.trim(), pass = $('login-password').value;
        errEl.classList.add('hidden');
        if (!usuario || !pass) { errEl.textContent = 'Introduce tu usuario y tu clave.'; return errEl.classList.remove('hidden'); }
        btn.disabled = true;
        try { this.onAuthSuccess(await FirebaseService.login(usuario, pass)); }
        catch (err) {
            errEl.textContent = LOGIN_ERRORS[err.code] || ('Error de acceso: ' + err.message);
            errEl.classList.remove('hidden');
        } finally { btn.disabled = false; }
    },

    /* ---------- Permisos de la categoría del usuario ---------- */
    applyPermissions(session) {
        const cl = document.body.classList;
        cl.toggle('is-admin', !!session?.esAdmin);
        const adminBtn = $('open-admin-btn'); if (adminBtn) adminBtn.hidden = !session?.esAdmin;
        PERMISOS.forEach(p => cl.toggle(`perm-no-${p.k}`, !(session && (session.esAdmin || session.permisos?.[p.k] === true))));
    },

    onAuthSuccess(session) {
        this.applyPermissions(session);
        $('login-overlay').classList.add('hidden');$('main-content').classList.remove('hidden');
        $('user-info').innerHTML = `<strong>${escapeHTML(session.nombre)}</strong>&nbsp;·&nbsp;${escapeHTML(session.rolNombre)}`;$('user-info').className = 'user-info-badge status-connected';
        FirebaseService.listenNovedades(
            items => this.onNovedadesUpdate(items),
            err => this.showMessage('Error', 'No se pudieron cargar los registros: ' + err.message));
        FirebaseService.listenAlarms(alarms => this.onAlarmsUpdate(alarms), err => console.error('Alarmas:', err));
        this.startAlarmEngine();
        clearInterval(agingInterval);
        agingInterval = setInterval(() => {
            if ($$('.modal-overlay:not(.hidden)').length || document.activeElement?.closest?.('#novedades-log')) return;
            this.applyFiltersAndRender(false);
        }, 10 * 60 * 1000);
    },

    onAuthError() {
        this.resetSession();
        $('login-overlay').classList.remove('hidden');$('main-content').classList.add('hidden');
        $('user-info').innerHTML = '<strong>Sin sesión</strong>';$('user-info').className = 'user-info-badge status-error';
    },

    onInitError(err) {
        console.error(err);
        const ayuda = { 'auth/admin-restricted-operation': ' Activa el acceso "Anónimo" en Firebase > Authentication > Sign-in method.', 'auth/operation-not-allowed': ' Activa el acceso "Anónimo" en Firebase > Authentication > Sign-in method.', 'permission-denied': ' Revisa las reglas de Firestore (ver instrucciones).' }[err.code] || '';
        $('login-error').textContent = 'No se pudo iniciar la aplicación: ' + err.message + ayuda;
        $('login-error').classList.remove('hidden');
    },

    resetSession() {
        this.applyPermissions(null); document.body.classList.remove('is-admin');
        clearInterval(alarmInterval); clearInterval(agingInterval); staleOnly = false;
        $('summary-bar').innerHTML = '';
        currentNovedades = []; filteredNovedades = []; currentAlarms = [];
        allNovedadesMap.clear(); selectedNovedadIds.clear(); triggeredAlarmsCache.clear();
        $('novedades-log').innerHTML = '';
        $('pagination-controls').innerHTML = '';$('active-alarms-list').innerHTML = '';
        $('export-button').disabled =$('export-pdf-button').disabled = $('delete-all-btn').disabled = true; this.updateWhatsappButton(); $$('.modal-overlay').forEach(m => m.classList.add('hidden'));$('login-password').value = '';
    },

    onNovedadesUpdate(items) {
        currentNovedades = items;
        allNovedadesMap.clear();
        items.forEach(n => allNovedadesMap.set(n.id, n));
        selectedNovedadIds.forEach(id => { if (!allNovedadesMap.has(id)) selectedNovedadIds.delete(id); });
        this.updateWhatsappButton();
        if (!$('comments-modal').classList.contains('hidden')) {
            const n = allNovedadesMap.get($('comment-novedad-id').value);
            if (n) this.renderComments(n.comentarios || []);
        }
        $('export-button').disabled =$('delete-all-btn').disabled = !currentNovedades.length;
        this.applyFiltersAndRender(false);
    },

    applyFiltersAndRender(resetPage = true) {
        const [vTurno, vPrioridad, vEstado, vText] = ['turno', 'prioridad', 'estado', 'text'].map(id => $(`filter-${id}`).value.toLowerCase().trim());
        const vFechaDesde = $('filter-fecha-desde').value;
        const vFechaHasta = $('filter-fecha-hasta').value;

        filteredNovedades = currentNovedades.filter(n => {
            if (vTurno && (n.turno || '').toLowerCase() !== vTurno) return false;
            if (vPrioridad && (n.prioridad || '').toLowerCase() !== vPrioridad) return false;
            if (vEstado && estadoDe(n).toLowerCase() !== vEstado) return false;
            if (staleOnly && !isStale(n)) return false;
            if (vFechaDesde || vFechaHasta) {
                const d = n.timestamp?.toDate ? n.timestamp.toDate() : null;
                if (!d) return false;
                const dStr = toLocalISODate(d);
                if (vFechaDesde && dStr < vFechaDesde) return false;
                if (vFechaHasta && dStr > vFechaHasta) return false;
            }
            if (vText && ![n.areaElemento, n.nReserva, n.habitacion, n.novedad, n.notificadoA].join(' ').toLowerCase().includes(vText)) return false;
            return true;
        });
        if (resetPage) currentPage = 1;
        this.renderCurrentPage();
        $('export-pdf-button').disabled = !filteredNovedades.length;
        this.renderSummary();
    },

    renderCurrentPage() {
        const totalPages = Math.max(1, Math.ceil(filteredNovedades.length / itemsPerPage));
        if (currentPage > totalPages) currentPage = totalPages;
        const pageData = filteredNovedades.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        const novedadesLog = $('novedades-log');
        if (!pageData.length) {
            const msg = currentNovedades.length ? 'Ningún registro coincide con los filtros.' : 'Todavía no hay novedades registradas.';
            novedadesLog.innerHTML = `<tr class="empty-row"><td colspan="13" style="text-align:center; padding:1.5rem; opacity:0.7;">${msg}</td></tr>`;
            this.updateSelectAllCheckboxState();
            return this.renderPagination();
        }
        novedadesLog.innerHTML = pageData.map(n => {
            const d = n.timestamp?.toDate ? n.timestamp.toDate() : new Date();
            const isChecked = selectedNovedadIds.has(n.id) ? 'checked' : '';
            
            const lastEditorText = n.lastEditedBy ? `Modificado por ${n.lastEditedBy.split('@')[0]} el ${formatFullTimestamp(n.lastEditedAt?.toDate?.())}` : '';
            const creatorText = `Creado por: ${n.userEmail ? n.userEmail.split('@')[0] : 'Sistema'} el ${formatFullTimestamp(n.timestamp?.toDate?.())}`;
            const tooltipTitle = escapeHTML(lastEditorText ? `${lastEditorText} | ${creatorText}` : creatorText);

            const compTit = n.estado === 'Completado' && n.completadoPor ? escapeHTML(`Completado por ${n.completadoPor} el ${formatFullTimestamp(n.completadoEn?.toDate?.())}`) : '';
            const priorClass = { 'Urgente':'badge-urgente', 'Alta':'badge-alta', 'Media':'badge-media' }[n.prioridad] || 'badge-baja';
            const count = n.comentarios?.length || 0;
            const stale = isStale(n);
            const ageBadge = stale ? `<span class="badge-age" title="Sigue Pendiente desde hace ${formatAge(Date.now() - novedadDate(n).getTime())}">⏰ ${formatAge(Date.now() - novedadDate(n).getTime())}</span>` : '';

            return `
            <tr class="novedad-row${stale ? ' row-stale' : ''}" data-id="${n.id}" title="${tooltipTitle}">
                <td class="cell-checkbox"><input type="checkbox" data-id="${n.id}" class="novedad-checkbox" ${isChecked}></td>
                <td class="cell-turno">${escapeHTML(n.turno)}</td>
                <td class="cell-fecha">${formatDate(d)}<br><span class="hora">${d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</span></td>
                <td class="cell-prioridad"><span class="badge ${priorClass}">${escapeHTML(n.prioridad)}</span>${ageBadge}</td>
                <td class="cell-area">${escapeHTML(n.areaElemento || '-')}</td>
                <td class="cell-reserva">${escapeHTML(n.nReserva || '-')}</td>
                <td class="cell-habitacion">${escapeHTML(n.habitacion || '-')}</td>
                <td class="cell-novedad" title="${escapeHTML(n.novedad)}">${escapeHTML(n.novedad)}</td>
                <td class="cell-notificado">${escapeHTML(n.notificadoA || '-')}</td>
                <td class="cell-estado">
                    <select data-id="${n.id}" ${can('estado') ? '' : 'disabled'} class="estado-select ${n.estado==='Completado'?'status-completado':'status-encurso'}" title="${compTit}">
                        <option value="Pendiente" ${n.estado!=='Completado'?'selected':''}>Pendiente</option>
                        <option value="Completado" ${n.estado==='Completado'?'selected':''}>Completado</option>
                    </select>
                </td>
                <td class="cell-comments">
                    <button data-id="${n.id}" class="button-icon comments-novedad-btn ${count>0?'button-primary':'button-secondary'}" title="Respuestas">
                        <svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clip-rule="evenodd" /></svg>
                        <span style="font-size:0.8rem;font-weight:bold;margin-left:2px;">${count}</span>
                    </button>
                </td>
                <td class="cell-edit">
                    <button data-id="${n.id}" class="button-icon edit-novedad-btn" title="Editar"><svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M5.433 13.917V17.5h3.583L16.5 10.917l-3.583-3.584L5.433 13.917zm13.197-6.264a.75.75 0 000-1.06l-2.062-2.062a.75.75 0 00-1.06 0l-1.41 1.41 3.584 3.584 1.41-1.41z"/></svg></button>
                </td>
                <td class="cell-delete">
                    <button data-id="${n.id}" class="button-icon delete-novedad-btn" title="Borrar"><svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75V4.5h8V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4.5A1.25 1.25 0 0111.25 3h2.5A1.25 1.25 0 0115 4.25V5.5h-5V4.25zM3.75 6A1.75 1.75 0 002 7.75v7.5A1.75 1.75 0 003.75 17h12.5A1.75 1.75 0 0018 15.25v-7.5A1.75 1.75 0 0016.25 6H3.75zM10 10a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 10zM13 10a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0113 10zM7 10a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 017 10z" clip-rule="evenodd"/></svg></button>
                </td>
            </tr>`;
        }).join('');
        this.updateSelectAllCheckboxState();
        this.renderPagination();
    },

    updateSelectAllCheckboxState() {
        const masterCb = $('select-all-filtered-checkbox');
        if (!masterCb) return;
        const pageData = filteredNovedades.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
        if (!pageData.length) {
            masterCb.checked = false;
            masterCb.indeterminate = false;
            masterCb.disabled = true;
            return;
        }
        masterCb.disabled = false;
        const idsInPage = pageData.map(n => n.id);
        const selectedCountInPage = idsInPage.filter(id => selectedNovedadIds.has(id)).length;

        masterCb.checked = selectedCountInPage === pageData.length;
        masterCb.indeterminate = selectedCountInPage > 0 && selectedCountInPage < pageData.length;
    },

    renderPagination() {
        const pages = Math.ceil(filteredNovedades.length / itemsPerPage);
        const limite = FirebaseService.fetchLimit;
        const aviso = currentNovedades.length >= limite ? `<span class="page-info" style="flex-basis:100%;text-align:center;">Se muestran los últimos ${limite} registros.</span>` : '';
        $('pagination-controls').innerHTML = pages ? `
            <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} id="btn-prev">&laquo; Anterior</button>
            <span class="page-info">Página ${currentPage} de ${pages}</span>
            <button class="page-btn" ${currentPage === pages ? 'disabled' : ''} id="btn-next">Siguiente &raquo;</button>${aviso}` : '';
        if (!pages) return;
        $('btn-prev').onclick = () => { currentPage--; this.renderCurrentPage(); };$('btn-next').onclick = () => { currentPage++; this.renderCurrentPage(); };
    },

    handleTableClick(e) {
        if (window.matchMedia('(max-width: 1024px)').matches) {
            const row = e.target.closest('.novedad-row');
            if (row && !e.target.closest('.cell-checkbox')) return abrirModalDetalleMovil(allNovedadesMap.get(row.dataset.id));
        }
        const btn = e.target.closest('button');
        if (!btn) return;
        const n = allNovedadesMap.get(btn.dataset.id);
        if (btn.classList.contains('delete-novedad-btn')) {
            $('confirm-delete-btn').dataset.id = btn.dataset.id;
            this.openModal($('confirm-modal'));
        } else if (btn.classList.contains('edit-novedad-btn')) { if (n) this.openNovedadModal(n); }
        else if (btn.classList.contains('comments-novedad-btn')) this.openComments(n);
    },

    handleTableChange(e) {
        if (e.target.classList.contains('novedad-checkbox')) {
            e.target.checked ? selectedNovedadIds.add(e.target.dataset.id) : selectedNovedadIds.delete(e.target.dataset.id);
            this.updateWhatsappButton();
            this.updateSelectAllCheckboxState();
        } else if (e.target.classList.contains('estado-select')) {
            if (!can('estado')) return this.applyFiltersAndRender(false);
            FirebaseService.changeEstadoNovedad(e.target.dataset.id, e.target.value).catch(err => {
                this.showMessage('Error', 'No se pudo cambiar el estado: ' + err.message);
                this.applyFiltersAndRender(false);
            });
        }
    },

    async handleMobileEstado(e) {
        if (!(can('estado'))) return;
        const id = e.currentTarget.dataset.id, n = allNovedadesMap.get(id);
        this.closeModal($('mobile-detail-modal'));
        if (!n) return;
        try { await FirebaseService.changeEstadoNovedad(id, n.estado === 'Completado' ? 'Pendiente' : 'Completado'); }
        catch (err) { this.showMessage('Error', 'No se pudo cambiar el estado: ' + err.message); }
    },

    openNovedadModal(novedad = null) {
        if (!can(novedad ? 'editar' : 'crear')) return;
        $('novedad-form').reset();
        this.resetMultiselect();
        if (novedad) {
            $('novedad-modal-title').textContent = 'Editar Novedad';$('novedad-id').value = novedad.id;
            $('prioridad').value = novedad.prioridad || 'Media';$('nReserva').value = novedad.nReserva || '';
            $('habitacion').value = novedad.habitacion || '';$('areaElemento').value = novedad.areaElemento || '';
            $('novedad').value = novedad.novedad || '';$('current-shift').textContent = novedad.turno || '--:--';
            $('novedad-metadata').classList.remove('hidden');$('novedad-metadata').textContent = `Creado por: ${novedad.userEmail || '--'} el ${formatFullTimestamp(novedad.timestamp?.toDate?.())}`;
            $('draft-notice').classList.add('hidden');
            const sel = (novedad.notificadoA || '').split(',').map(s => s.trim());
            $$('.multiselect-option').forEach(cb => cb.checked = sel.includes(cb.value));
            this.updateMultiselectLabel();
        } else {
            $('novedad-modal-title').textContent = 'Nueva Novedad';$('novedad-id').value = '';
            $('novedad-metadata').classList.add('hidden');$('current-shift').textContent = this.calcularTurno();
            $('draft-notice').classList.add('hidden');
            this.restoreDraft();
        }
        this.actualizarColorPrioridad($('prioridad'));
        this.openModal($('novedad-modal'), 'areaElemento');
    },

    async handleNovedadSubmit(e) {
        e.preventDefault();
        if (!can($('novedad-id').value ? 'editar' : 'crear')) return this.showMessage('Sin permiso', 'Tu categoría no puede realizar esta acción.');
        $('submit-button').disabled = true;
        $('loading-spinner').classList.remove('hidden');
        const fd = new FormData($('novedad-form')); const payload = { prioridad: fd.get('prioridad').trim(), nReserva: fd.get('nReserva').trim() || null, habitacion: fd.get('habitacion').trim() || null, areaElemento: fd.get('areaElemento').trim(), novedad: fd.get('novedad').trim(), notificadoA: Array.from($$('.multiselect-option:checked')).map(cb => cb.value).join(', ') || null
        };
        try {
            const id = $('novedad-id').value;
            if (id) await FirebaseService.updateNovedad(id, payload);
            else { await FirebaseService.addNovedad({ ...payload, turno: this.calcularTurno() }); this.clearDraft(); }
            this.closeModal($('novedad-modal'));
        } catch (err) { this.showMessage('Error', err.message); }
        finally { $('submit-button').disabled = false; $('loading-spinner').classList.add('hidden'); }
    },

    openComments(nov) {
        if (!nov) return;
        $('comment-novedad-id').value = nov.id;
        $('comments-context').innerHTML = `${nov.areaElemento ? `<b>Área:</b> ${escapeHTML(nov.areaElemento)}<br>` : ''} "${escapeHTML(nov.novedad)}"`;
        this.renderComments(nov.comentarios || []);
        this.openModal($('comments-modal'), 'new-comment-text');
    },

    renderComments(arr) {
        const list = $('comments-list');
        list.innerHTML = arr.length ? arr.map(c => `
            <div class="comment-bubble">
                <div class="comment-meta"><strong>${escapeHTML((c.user || '').split('@')[0])}</strong><span>${new Date(c.timestamp).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
                <div class="comment-text">${escapeHTML(c.text)}</div>
            </div>`).join('') : '<p class="text-center">No hay respuestas.</p>';
        list.scrollTop = list.scrollHeight;
    },

    async handleCommentSubmit(e) {
        e.preventDefault();
        if (!can('comentar')) return;
        const text = $('new-comment-text').value.trim();
        if (!text) return;
        const btn = $('save-comment-btn');
        btn.disabled = true;
        try { await FirebaseService.addComentario($('comment-novedad-id').value, text);$('new-comment-text').value = ''; }
        catch (err) { this.showMessage('Error', 'Fallo al comentar: ' + err.message); }
        finally { btn.disabled = false; }
    },

    async handleDeleteAll() {
        if (!can('borrarTodo')) return;
        const btn = $('confirm-delete-all-btn');
        btn.disabled = true;
        try {
            await FirebaseService.deleteAllNovedades();
            selectedNovedadIds.clear();
            this.updateWhatsappButton();
            this.closeModal($('delete-all-modal'));
        } catch (err) { this.showMessage('Error', 'No se pudo borrar todo: ' + err.message); }
        finally { btn.disabled = false; }
    },

    populateMultiselect() {
        const dd = $('multiselect-dropdown-container').querySelector('.multiselect-dropdown');
        dd.innerHTML = '<label class="multiselect-option-label"><input type="checkbox" id="multiselect-select-all"><span class="font-semibold">(Seleccionar todo)</span></label>';
        multiselectOptions.forEach((opt, i) => dd.insertAdjacentHTML('beforeend',
            `<label class="multiselect-option-label" for="ms-${i}"><input type="checkbox" id="ms-${i}" value="${escapeHTML(opt)}" class="multiselect-option"><span>${escapeHTML(opt)}</span></label>`));
        $$('.multiselect-option').forEach(cb => cb.addEventListener('change', () => this.updateMultiselectLabel()));$('multiselect-select-all').addEventListener('change', e => {
            $$('.multiselect-option').forEach(cb => cb.checked = e.target.checked); this.updateMultiselectLabel(); }); },      resetMultiselect() { $$
('.multiselect-dropdown input[type="checkbox"]').forEach(c => c.checked = false);
        $('multiselect-search').value = '';$$('.multiselect-option-label').forEach(el => el.classList.remove('hidden')); this.updateMultiselectLabel(); },      updateMultiselectLabel() { const checked = $$('.multiselect-option:checked'), total = multiselectOptions.length, label =$('multiselect-label');
        label.textContent = !checked.length ? 'Elige' : checked.length === total ? 'Todos seleccionados'
            : checked.length > 2 ? `${checked.length} seleccionados` : Array.from(checked).map(c => c.value).join(', ');
        label.className = checked.length ? 'multiselect-label-selected' : 'multiselect-label-default';
        $('multiselect-select-all').checked = checked.length === total;
        $('multiselect-select-all').indeterminate = checked.length > 0 && checked.length < total;
    },

    updateWhatsappButton() {
        const btn = $('whatsapp-copy-button');
        btn.disabled = !selectedNovedadIds.size;
        btn.innerHTML = `${WHATSAPP_ICON} Whatsapp (${selectedNovedadIds.size})`;
    },

    copyWhatsapp() {
        if (!can('whatsapp')) return;
        const parts = [], usuario = FirebaseService.session?.nombre || '';
        ['Mañana', 'Tarde', 'Noche', 'Sin Turno'].forEach(t => {
            const novs = Array.from(selectedNovedadIds).map(id => allNovedadesMap.get(id)).filter(n => n && (n.turno || 'Sin Turno') === t);
            if (novs.length) parts.push(`\n*Novedades Turno ${t}${usuario ? ' ' + usuario : ''}*\n` + novs.map(n => {
                const d = novedadDate(n) || new Date();
                const fecha = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
                const respuesta = (n.comentarios || []).map(c => String(c.text || '').trim()).filter(Boolean).join(' / ');
                return [fecha, n.nReserva ? `RVA ${n.nReserva}` : '', n.habitacion ? `HAB ${n.habitacion}` : '', n.novedad].filter(Boolean).join(' ')
                    + ` ${estadoDe(n).toUpperCase()}` + (respuesta ? ` - ${respuesta}` : '');
            }).join('\n'));
        });
        navigator.clipboard.writeText(parts.join('\n').trim()).then(() => {
            selectedNovedadIds.clear(); 
            this.updateWhatsappButton(); 
            this.applyFiltersAndRender(false);
            this.showMessage('Éxito', 'Copiado a portapapeles.');
        }).catch(() => this.showMessage('Error', 'No se pudo copiar.'));
    },

    exportExcel() {
        if (!can('excel')) return;
        if (typeof XLSX === 'undefined') return this.showMessage('Error', 'La librería para generar el Excel no se ha cargado.');
        const dataToExport = filteredNovedades.map(n => {
            const d = n.timestamp?.toDate ? n.timestamp.toDate() : new Date();
            const respuestasTexto = (n.comentarios || []).map(c => {
                const cDate = new Date(c.timestamp).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                const cUser = (c.user||'').split('@')[0];
                return `[${cDate} | ${cUser}]: ${c.text}`;
            }).join('\n');
            return {
                "Turno": n.turno || '-',
                "Fecha": formatDate(d),
                "Hora": d.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
                "Prioridad": n.prioridad || '-',
                "Área/Elemento": n.areaElemento || '-',
                "Nº Reserva": n.nReserva || '-',
                "Habitación": n.habitacion || '-',
                "Novedad": n.novedad || '-',
                "Notificado a": n.notificadoA || '-',
                "Estado": estadoDe(n),
                "Respuestas": respuestasTexto || 'Sin respuestas'
            };
        });
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Novedades');
        XLSX.writeFile(workbook, `Registro_Diario_${toLocalISODate(new Date())}.xlsx`);
    },

    exportPDF() {
        if (!can('pdf')) return;
        if (!filteredNovedades.length) return this.showMessage('Aviso', 'No hay registros visibles para exportar.');
        const printWindow = window.open('', '_blank');
        if (!printWindow) return this.showMessage('Error', 'El navegador bloqueó la ventana emergente para generar el reporte.');
        
        const rowsHtml = filteredNovedades.map(n => {
            const d = n.timestamp?.toDate ? n.timestamp.toDate() : new Date();
            return `
                <tr>
                    <td>${escapeHTML(n.turno)}</td>
                    <td>${formatDate(d)} ${d.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</td>
                    <td>${escapeHTML(n.prioridad)}</td>
                    <td>${escapeHTML(n.areaElemento || '-')}</td>
                    <td>${escapeHTML(n.nReserva || '-')}</td>
                    <td>${escapeHTML(n.habitacion || '-')}</td>
                    <td>${escapeHTML(n.novedad)}</td>
                    <td>${escapeHTML(n.notificadoA || '-')}</td>
                    <td>${escapeHTML(estadoDe(n))}</td>
                </tr>
            `;
        }).join('');

        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Novedades - Registro Diario</title>
                <style>
                    body { font-family: Arial, sans-serif; color: #222; margin: 20px; }
                    h1 { font-size: 18px; margin-bottom: 5px; }
                    p { font-size: 12px; color: #555; margin-bottom: 15px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
                    th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
                    th { background-color: #f0f0f0; font-weight: bold; }
                    tr:nth-child(even) { background-color: #fafafa; }
                </style>
            </head>
            <body>
                <h1>Reporte de Novedades / Registro Diario</h1>
                <p>Generado el: ${new Date().toLocaleString('es-ES')} | Total de registros mostrados: ${filteredNovedades.length}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Turno</th>
                            <th>Fecha/Hora</th>
                            <th>Prioridad</th>
                            <th>Área/Elemento</th>
                            <th>Nº Reserva</th>
                            <th>Habit.</th>
                            <th>Novedad</th>
                            <th>Notificado a</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
                <script>
                    window.onload = function() {
                        window.print();
                    };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    },

    syncReminderFields() {
        const v = $('reminder-type').value;
        $('reminder-date-group').classList.toggle('hidden', v !== 'once');
        $('reminder-day-group').classList.toggle('hidden', v !== 'weekly');$('reminder-month-days-group').classList.toggle('hidden', v !== 'monthly');
    },

    async handleReminderSubmit(e) {
        e.preventDefault();
        if (!can('alarmas')) return;
        const type = $('reminder-type').value;
        let monthDays = $('reminder-month-days').value;
        if (type === 'once' && !$('reminder-date').value) return this.showMessage('Alarma', 'Elige la fecha de la alarma.');
        if (type === 'monthly') {
            const dias = (monthDays.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= 31);
            if (!dias.length) return this.showMessage('Alarma', 'Escribe al menos un día del mes válido (1 a 31), separados por coma.');
            monthDays = [...new Set(dias)].join(', ');
        }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            await FirebaseService.addAlarm({
                message: $('reminder-message').value.trim(), type, time:$('reminder-time').value,
                date: $('reminder-date').value, day:$('reminder-day').value, monthDays
            });
            e.target.reset(); 
            this.syncReminderFields();
            this.closeModal($('reminder-modal'));
        } catch (err) { this.showMessage('Error', 'No se pudo guardar la alarma: ' + err.message); }
        finally { btn.disabled = false; }
    },

    onAlarmsUpdate(alarms) {
        currentAlarms = alarms;
        const list = $('active-alarms-list');
        const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const tipos = { once: 'Una vez', daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual' };
        list.innerHTML = alarms.length ? alarms.map(a => {
            const hora = escapeHTML(a.time);
            const det = a.type === 'once' ? `${escapeHTML((a.date || '').split('-').reverse().join('/'))} a las ${hora}`
                : a.type === 'weekly' ? `Los ${dias[a.day] || '?'} a las ${hora}`
                : a.type === 'monthly' ? `Días: ${escapeHTML(a.monthDays)} a las ${hora}` : `A las ${hora}`;
            return `<div class="alarm-list-item">
                <div class="alarm-info">
                    <strong style="color: var(--color-texto-principal); font-size: 0.95rem;">${escapeHTML(a.message)}</strong>
                    <span style="color: var(--color-texto-secundario); font-size: 0.8rem;"><b style="color:#FA780C;">[${tipos[a.type] || '?'}]</b> ${det}</span>
                </div>
                <button class="button-icon delete-alarm-btn" data-id="${a.id}" title="Eliminar Alarma" style="color: #ef4444;">🗑️</button>
            </div>`;
        }).join('') : '<p style="padding: 1rem; text-align: center; color: var(--color-texto-secundario); font-size: 0.85rem;">No hay alarmas configuradas.</p>';
        this.checkAlarms();
    },

    startAlarmEngine() {
        clearInterval(alarmInterval);
        alarmInterval = setInterval(() => this.checkAlarms(), 15000);
    },

    checkAlarms() {
        const now = new Date();
        const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, dt = toLocalISODate(now);
        if (triggeredCacheDate !== dt) { triggeredAlarmsCache.clear(); triggeredCacheDate = dt; }
        currentAlarms.forEach(a => {
            if (a.time !== t) return;
            const ring = a.type === 'daily'
                || (a.type === 'once' && a.date === dt)
                || (a.type === 'weekly' && String(a.day) === String(now.getDay()))
                || (a.type === 'monthly' && ((a.monthDays || '').match(/\d+/g) || []).map(Number).includes(now.getDate()));
            const key = `${a.id}-${dt}-${t}`;
            if (!ring || triggeredAlarmsCache.has(key)) return;
            triggeredAlarmsCache.add(key);
            this.showAlarm(a.message);
            this.playAlarmSound();
            if (a.type === 'once') FirebaseService.deleteAlarm(a.id).catch(() => {});
        });
    },

    showAlarm(message) {
        const el = $('alarm-trigger-message'), modal =$('alarm-trigger-modal');
        el.textContent = modal.classList.contains('hidden') ? message : `${el.textContent}\n${message}`;
        el.style.whiteSpace = 'pre-line';
        if (modal.classList.contains('hidden')) this.openModal(modal);
    },

    playAlarmSound() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            for (let i = 0; i < 3; i++) {
                const osc = ctx.createOscillator(), gain = ctx.createGain(), s = ctx.currentTime + i * 0.4;
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = 'square'; osc.frequency.setValueAtTime(880, s);
                gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.2, s + 0.05); gain.gain.linearRampToValueAtTime(0, s + 0.3);
                osc.start(s); osc.stop(s + 0.35);
            }
            setTimeout(() => ctx.close?.(), 2500);
        } catch (e) { console.log('Audio no disponible.', e); }
    },

    actualizarColorPrioridad(el) {
        if (!el) return;
        el.classList.remove('prioridad-urgente', 'prioridad-alta', 'prioridad-media', 'prioridad-baja');
        const map = { Urgente: 'prioridad-urgente', Alta: 'prioridad-alta', Media: 'prioridad-media', Baja: 'prioridad-baja' };
        if (map[el.value]) el.classList.add(map[el.value]);
    },

    calcularTurno() {
        /* Turnos: Mañana 06:30-15:30 · Tarde 14:30-23:30 · Noche 23:00-07:00.
           En las horas donde se superponen (14:30-15:30, 23:00-23:30, 06:30-07:00) manda el turno que entra. */
        const now = new Date(), min = now.getHours() * 60 + now.getMinutes();
        return (min >= 390 && min < 870) ? 'Mañana' : (min >= 870 && min < 1380) ? 'Tarde' : 'Noche';
    }
};