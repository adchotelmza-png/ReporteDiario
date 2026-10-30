/* =====================================================================
   firebase-service.js — Acceso a Firebase / Firestore
   Firebase solo se usa como "puerta" a Firestore (sesión anónima).
   El login real es usuario + clave, comprobados contra Firestore.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
    getAuth, onAuthStateChanged, setPersistence, browserSessionPersistence, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
    getFirestore, doc, setDoc, onSnapshot, collection, query,
    orderBy, limit, serverTimestamp, updateDoc, addDoc,
    getDocs, getDoc, deleteDoc, deleteField, writeBatch, arrayUnion, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

let db, auth;

const COL = {
    novedades: 'hotel_log',
    alarmas: 'hotel_alarms',
    usuarios: 'hotel_users',       // un documento por usuario (id = usuario en minúsculas)
    roles: 'hotel_roles',          // un documento por categoría
    checklist: 'hotel_checklist'   // una tarea por documento (el campo "orden" define la posición)
};
const SESSION_KEY = 'registro-diario:sesion';

/* Permisos que se pueden activar/desactivar por categoría (el Admin los tiene todos siempre) */
export const PERMISOS = [
    { k: 'crear',      label: 'Crear novedades' },
    { k: 'editar',     label: 'Editar novedades' },
    { k: 'borrar',     label: 'Borrar novedades' },
    { k: 'estado',     label: 'Cambiar estado (Pendiente / Resuelto)' },
    { k: 'comentar',   label: 'Responder / comentar' },
    { k: 'alarmas',    label: 'Crear y borrar alarmas' },
    { k: 'whatsapp',   label: 'Generar reporte (botón Reporte)' },
    { k: 'excel',      label: 'Exportar a Excel' },
    { k: 'pdf',        label: 'Exportar PDF / Imprimir' },
    { k: 'borrarTodo', label: 'Borrar TODOS los registros' },
    { k: 'checklist',  label: 'Armar / editar el Check List' }
];

/* Formato de clave: 1 mayúscula + minúsculas + 4 números (ej.: Lionel1234) */
export const CLAVE_REGEX = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\d{4}$/;
export const CLAVE_EJEMPLO = 'Lionel1234';

/* Turnos del Check List. Cada tarea tiene un campo "turnos" (ej.: ['Mañana','Noche']).
   Las tareas viejas, que no tienen ese campo, se consideran de los tres turnos. */
export const TURNOS = ['Mañana', 'Tarde', 'Noche'];
export const turnosDe = item => Array.isArray(item?.turnos) ? item.turnos.filter(t => TURNOS.includes(t)) : [...TURNOS];

const userId = u => String(u || '').trim().toLowerCase();
export const slug = t => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const colRef = name => collection(db, name);
const docRef = (name, id) => doc(db, name, id);
const toItems = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

let unsubNovedades = null, unsubAlarms = null, unsubChecklist = null;

export const FirebaseService = {
    user: null,      // usuario técnico de Firebase (anónimo)
    session: null,   // usuario real de la app: { usuario, nombre, rolId, rolNombre, permisos, esAdmin }

    /* Máximo de registros que se leen (se define en config.js) */
    get fetchLimit() { return window.APP_CONFIG?.FIRESTORE_FETCH_LIMIT || 200; },
    /* Nombre real del usuario conectado (se guarda en los registros que crea) */
    get email() { return this.session?.nombre || 'Sistema'; },
    can(permiso) { return !!this.session && (this.session.esAdmin || this.session.permisos?.[permiso] === true); },

    async init(onAuthSuccess, onAuthError, onInitError) {
        const firebaseConfig = window.APP_CONFIG?.FIREBASE_CONFIG;
        if (!firebaseConfig) throw new Error('config.js no se cargó o no define FIREBASE_CONFIG.');
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        await setPersistence(auth, browserSessionPersistence);
        await signInAnonymously(auth);

        onAuthStateChanged(auth, async user => {
            try {
                this.stopListeners();
                if (user) {
                    this.user = user;
                    await this.sembrarUsuariosIniciales();
                    this.session = await this.restoreSession();
                    this.session ? onAuthSuccess(this.session) : onAuthError();
                } else {
                    this.user = this.session = null;
                    onAuthError();
                }
            } catch (e) { onInitError ? onInitError(e) : console.error(e); }
        });
    },

    /* ---------- Sesión: usuario + clave ---------- */
    async login(usuario, clave) {
        const snap = await getDoc(docRef(COL.usuarios, userId(usuario)));
        if (!snap.exists() || snap.data().clave !== clave) {
            const err = new Error('Usuario o clave incorrectos.');
            err.code = 'app/invalid-credential';
            throw err;
        }
        this.session = await this.buildSession(snap.data());
        try { sessionStorage.setItem(SESSION_KEY, userId(usuario)); } catch (_) { /* sin almacenamiento */ }
        return this.session;
    },

    async restoreSession() {
        let id = null;
        try { id = sessionStorage.getItem(SESSION_KEY); } catch (_) { /* sin almacenamiento */ }
        if (!id) return null;
        const snap = await getDoc(docRef(COL.usuarios, id));
        return snap.exists() ? await this.buildSession(snap.data()) : null;   // si borraron al usuario, se cierra su sesión
    },

    async buildSession(u) {
        const rolSnap = await getDoc(docRef(COL.roles, u.rolId));
        const rol = rolSnap.exists() ? rolSnap.data() : { nombre: '(sin categoría)', permisos: {} };
        return { usuario: u.usuario, nombre: u.nombre, rolId: u.rolId, rolNombre: rol.nombre, permisos: rol.permisos || {}, esAdmin: u.rolId === 'admin' };
    },

    async logout() {
        this.stopListeners();
        this.session = null;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* nada */ }
    },

    /* El usuario conectado cambia su propia clave */
    async cambiarClave(actual, nueva, repetir) {
        if (!this.session) throw new Error('No hay sesión iniciada.');
        if (!actual || !nueva || !repetir) throw new Error('Completá los tres campos.');
        const ref = docRef(COL.usuarios, userId(this.session.usuario));
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Tu usuario ya no existe.');
        if (snap.data().clave !== actual) throw new Error('La clave actual es incorrecta.');
        if (!CLAVE_REGEX.test(nueva)) throw new Error(`La clave nueva debe tener la primera letra en mayúscula, luego minúsculas y 4 números. Ejemplo: ${CLAVE_EJEMPLO}`);
        if (nueva !== repetir) throw new Error('La clave nueva y su repetición no coinciden.');
        if (nueva === actual) throw new Error('La clave nueva debe ser distinta de la actual.');
        await updateDoc(ref, { clave: nueva });
    },

    async verifyAdminPassword(clave) {
        const snap = await getDocs(colRef(COL.usuarios));
        return snap.docs.some(d => d.data().rolId === 'admin' && d.data().clave === clave);
    },

    /* Carga los usuarios y categorías de seed.js, solo si la base de usuarios está vacía */
    async sembrarUsuariosIniciales() {
        const snap = await getDocs(colRef(COL.usuarios));
        if (!snap.empty) return;
        let SEED;
        try { ({ SEED } = await import('./seed.js')); }
        catch (e) { console.warn('No se pudo cargar seed.js:', e); return; }   // sin seed.js no se carga nada
        for (const r of SEED.roles) await setDoc(docRef(COL.roles, r.id), { nombre: r.nombre, permisos: r.permisos, sistema: !!r.sistema });
        for (const u of SEED.usuarios) await setDoc(docRef(COL.usuarios, userId(u.usuario)), { usuario: u.usuario, clave: u.clave, nombre: u.nombre, rolId: u.rolId });
    },

    /* ---------- Administración de usuarios y categorías ---------- */
    async listUsers() {
        const snap = await getDocs(colRef(COL.usuarios));
        return toItems(snap).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    },

    async listRoles() {
        const snap = await getDocs(colRef(COL.roles));
        return toItems(snap).sort((a, b) => a.id === 'admin' ? -1 : b.id === 'admin' ? 1 : (a.nombre || '').localeCompare(b.nombre || ''));
    },

    /* originalId: id del usuario que se está editando (null si es nuevo). Permite cambiar el nombre de usuario. */
    async saveUser({ usuario, clave, nombre, rolId }, originalId = null) {
        const id = userId(usuario);
        if (!id || !clave || !nombre || !rolId) throw new Error('Completá usuario, clave, nombre real y categoría.');
        if (/\s/.test(id)) throw new Error('El usuario no puede tener espacios.');
        if (id !== originalId && (await getDoc(docRef(COL.usuarios, id))).exists()) throw new Error('Ya existe un usuario con ese nombre de usuario.');
        await setDoc(docRef(COL.usuarios, id), { usuario: usuario.trim(), clave, nombre: nombre.trim(), rolId });
        if (originalId && originalId !== id) await deleteDoc(docRef(COL.usuarios, originalId));
    },

    async deleteUser(id) {
        const users = await this.listUsers();
        const u = users.find(x => x.id === id);
        if (u?.rolId === 'admin' && users.filter(x => x.rolId === 'admin').length <= 1) throw new Error('No se puede borrar al único Admin.');
        if (id === userId(this.session?.usuario)) throw new Error('No podés borrar tu propio usuario mientras estás conectado.');
        await deleteDoc(docRef(COL.usuarios, id));
    },

    async saveRole({ id, nombre, permisos }) {
        const texto = String(nombre || '').trim();
        const rid = id || slug(texto);
        if (!rid || !texto) throw new Error('Escribí el nombre de la categoría.');
        if (!id && (await getDoc(docRef(COL.roles, rid))).exists()) throw new Error('Ya existe una categoría con ese nombre.');
        await setDoc(docRef(COL.roles, rid), { nombre: texto, permisos, sistema: rid === 'admin' });
        return rid;
    },

    async deleteRole(id) {
        if (id === 'admin') throw new Error('La categoría Admin no se puede borrar.');
        const n = (await this.listUsers()).filter(u => u.rolId === id).length;
        if (n) throw new Error(`No se puede borrar: ${n} usuario(s) pertenecen a esta categoría. Movelos o borralos primero.`);
        await deleteDoc(docRef(COL.roles, id));
    },

    stopListeners() {
        unsubNovedades?.(); unsubAlarms?.(); unsubChecklist?.();
        unsubNovedades = unsubAlarms = unsubChecklist = null;
    },

    /* ---------- Check List (lo arma el Jefe de Recepción; lo ven todos) ---------- */
    /* Pueden armarlo: Admin, Gerencia, Jefe Recepción, o cualquier categoría con el permiso "checklist" */
    puedeEditarChecklist() {
        const s = this.session;
        return !!s && (s.esAdmin || ['gerencia', 'jefe-recepcion'].includes(s.rolId) || s.permisos?.checklist === true);
    },

    _exigirChecklist() {
        if (!this.puedeEditarChecklist()) throw new Error('No tenés permiso para editar el Check List.');
    },

    listenChecklist(callback, onError) {
        unsubChecklist?.();
        const q = query(colRef(COL.checklist), orderBy('orden', 'asc'));
        unsubChecklist = onSnapshot(q, snap => callback(toItems(snap)), onError);
    },

    async addChecklistItem(tarea, turnos = TURNOS) {
        this._exigirChecklist();
        const texto = String(tarea || '').trim();
        if (!texto) throw new Error('Escribí la tarea.');
        const t = TURNOS.filter(x => (turnos || []).includes(x));
        if (!t.length) throw new Error('Marcá al menos un turno para la tarea.');
        return await addDoc(colRef(COL.checklist), { tarea: texto, turnos: t, orden: Date.now(), creadoPor: this.email, creadoEn: serverTimestamp() });
    },

    /* Define a qué turnos pertenece una tarea (se guarda la lista completa, en el orden Mañana / Tarde / Noche) */
    async setChecklistTurnos(id, turnos) {
        this._exigirChecklist();
        const t = TURNOS.filter(x => (turnos || []).includes(x));
        return await updateDoc(docRef(COL.checklist, id), { turnos: t, editadoPor: this.email, editadoEn: serverTimestamp() });
    },

    async updateChecklistItem(id, tarea) {
        this._exigirChecklist();
        const texto = String(tarea || '').trim();
        if (!texto) throw new Error('La tarea no puede quedar vacía.');
        return await updateDoc(docRef(COL.checklist, id), { tarea: texto, editadoPor: this.email, editadoEn: serverTimestamp() });
    },

    async deleteChecklistItem(id) {
        this._exigirChecklist();
        return await deleteDoc(docRef(COL.checklist, id));
    },

    /* Intercambia la posición de dos tareas (para subir / bajar) */
    async swapChecklistOrden(a, b) {
        this._exigirChecklist();
        const batch = writeBatch(db);
        batch.update(docRef(COL.checklist, a.id), { orden: b.orden });
        batch.update(docRef(COL.checklist, b.id), { orden: a.orden });
        await batch.commit();
    },

    /* ---------- Novedades ---------- */
    listenNovedades(callback, onError) {
        unsubNovedades?.();
        const q = query(colRef(COL.novedades), orderBy('timestamp', 'desc'), limit(this.fetchLimit));
        unsubNovedades = onSnapshot(q, snap => callback(toItems(snap)), onError);
    },

    /* fechaManual (Date, opcional): solo se respeta si el usuario es Admin; permite cargar una novedad con fecha anterior */
    async addNovedad(payload, fechaManual = null) {
        const retroactiva = !!fechaManual && !!this.session?.esAdmin;
        if (retroactiva && (isNaN(fechaManual) || fechaManual > new Date())) throw new Error('La fecha elegida no es válida o es futura.');
        return await addDoc(colRef(COL.novedades), {
            ...payload,
            timestamp: retroactiva ? Timestamp.fromDate(fechaManual) : serverTimestamp(),
            userId: this.user.uid,
            userEmail: this.email,   // nombre real (el campo conserva su nombre por compatibilidad con registros viejos)
            userUsuario: this.session?.usuario || null,
            estado: 'Pendiente',
            comentarios: [],
            ...(retroactiva ? { fechaManual: true, cargadaEn: serverTimestamp() } : {})
        });
    },

    async updateNovedad(id, payload) {
        return await updateDoc(docRef(COL.novedades, id), { ...payload, lastEditedBy: this.email, lastEditedAt: serverTimestamp() });
    },

    async deleteNovedad(id) { return await deleteDoc(docRef(COL.novedades, id)); },

    async changeEstadoNovedad(id, nuevoEstado) {
        const payload = nuevoEstado === 'Resuelto'
            ? { estado: nuevoEstado, resueltoEn: serverTimestamp(), resueltoPor: this.email }
            : { estado: nuevoEstado, resueltoEn: deleteField(), resueltoPor: deleteField() };   // al reabrirla se borra quién/cuándo la resolvió
        return await updateDoc(docRef(COL.novedades, id), payload);
    },

    async addComentario(id, text) {
        return await updateDoc(docRef(COL.novedades, id), {
            comentarios: arrayUnion({ text, user: this.email, timestamp: new Date().toISOString() })
        });
    },

    /* Borra solo las novedades del Registro Diario (las nuevas reservas web están en otra colección) */
    async deleteAllNovedades() {
        const snap = await getDocs(colRef(COL.novedades));
        for (let i = 0; i < snap.docs.length; i += 400) {
            const batch = writeBatch(db);
            snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    },

    /* ---------- Alarmas ---------- */
    listenAlarms(callback, onError) {
        unsubAlarms?.();
        const q = query(colRef(COL.alarmas), orderBy('timestamp', 'desc'));
        unsubAlarms = onSnapshot(q, snap => callback(toItems(snap)), onError);
    },

    async addAlarm(alarmData) { return await addDoc(colRef(COL.alarmas), { ...alarmData, timestamp: serverTimestamp() }); },
    async deleteAlarm(id) { return await deleteDoc(docRef(COL.alarmas, id)); }
};
