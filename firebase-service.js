import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, 
    setPersistence, browserSessionPersistence, signOut, 
    signInAnonymously, signInWithCustomToken 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { 
    getFirestore, doc, setDoc, onSnapshot, collection, query, 
    orderBy, limit, serverTimestamp, updateDoc, addDoc, 
    getDocs, getDoc, deleteDoc, writeBatch, arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

const isCanvasEnvironment = typeof __app_id !== 'undefined';
const appId = isCanvasEnvironment ? __app_id : 'default-hotel-app'; 
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

let db, auth;
const COLLECTION_NAME = 'hotel_log'; 
const ALARMS_COLLECTION_NAME = 'hotel_alarms';
const USERS_COLLECTION_NAME = 'hotel_users';   // un documento por usuario (id = usuario en minúsculas)
const ROLES_COLLECTION_NAME = 'hotel_roles';   // un documento por categoría
const CHECKLIST_COLLECTION_NAME = 'hotel_checklist';   // una tarea del Check List por documento (campo "orden" define la posición)
const SESSION_KEY = 'registro-diario:sesion';

/* Permisos que se pueden activar/desactivar por categoría (el Admin los tiene todos siempre) */
export const PERMISOS = [
    { k: 'crear',      label: 'Crear novedades' },
    { k: 'editar',     label: 'Editar novedades' },
    { k: 'borrar',     label: 'Borrar novedades' },
    { k: 'estado',     label: 'Cambiar estado (En curso / Completado)' },
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
const userId = u => String(u || '').trim().toLowerCase();
export const slug = t => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const getPath = (colName) => isCanvasEnvironment ? `artifacts/${appId}/public/data/${colName}` : colName;

let unsubNovedades = null;
let unsubAlarms = null;
let unsubChecklist = null;

export const FirebaseService = {
    user: null,      // usuario técnico de Firebase (anónimo, solo da acceso a Firestore)
    session: null,   // usuario real de la app: { usuario, nombre, rolId, rolNombre, permisos, esAdmin }

    // Máximo de registros que se leen (se define en config.js)
    get fetchLimit() { return window.APP_CONFIG?.FIRESTORE_FETCH_LIMIT || 200; },
    // Email del usuario con valor de respaldo (las cuentas anónimas no tienen email)
    // (se mantiene el nombre "email" por compatibilidad: ahora devuelve el NOMBRE REAL, ej. "Castro Rodrigo")
    get email() { return this.session?.nombre || 'Sistema'; },
    can(permiso) { return !!this.session && (this.session.esAdmin || this.session.permisos?.[permiso] === true); },

    async init(onAuthSuccess, onAuthError, onInitError) {
        // La configuración se lee aquí (no al importar) para poder mostrar un error claro si falta config.js
        const firebaseConfig = window.APP_CONFIG?.FIREBASE_CONFIG;
        if (!firebaseConfig) throw new Error('config.js no se cargó o no define FIREBASE_CONFIG.');
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Firebase solo se usa como "puerta" a Firestore (sesión anónima). El login real es usuario + clave contra Firestore.
        if (isCanvasEnvironment) {
            if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken).catch(() => signInAnonymously(auth));
            else await signInAnonymously(auth);
        } else {
            await setPersistence(auth, browserSessionPersistence);
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, async (user) => {
            try {
                if (user) {
                    this.user = user;
                    this.stopListeners();
                    await this.inicializarCategoriasBase();
                    await this.sembrarUsuariosIniciales();
                    this.session = await this.restoreSession();
                    this.session ? onAuthSuccess(this.session) : onAuthError();
                } else {
                    this.user = this.session = null;
                    this.stopListeners();
                    onAuthError();
                }
            } catch (e) { onInitError ? onInitError(e) : console.error(e); }
        });
    },

    /* ---------- Login por usuario + clave ---------- */
    async login(usuario, clave) {
        const snap = await getDoc(doc(db, getPath(USERS_COLLECTION_NAME), userId(usuario)));
        if (!snap.exists() || snap.data().clave !== clave) {
            const err = new Error('Usuario o clave incorrectos.'); err.code = 'app/invalid-credential'; throw err;
        }
        this.session = await this.buildSession(snap.data());
        try { sessionStorage.setItem(SESSION_KEY, userId(usuario)); } catch (_) { /* sin almacenamiento */ }
        return this.session;
    },

    async restoreSession() {
        let id = null;
        try { id = sessionStorage.getItem(SESSION_KEY); } catch (_) { /* sin almacenamiento */ }
        if (!id) return null;
        const snap = await getDoc(doc(db, getPath(USERS_COLLECTION_NAME), id));
        return snap.exists() ? await this.buildSession(snap.data()) : null;   // si borraron al usuario, se cierra su sesión
    },

    async buildSession(u) {
        const rolSnap = await getDoc(doc(db, getPath(ROLES_COLLECTION_NAME), u.rolId));
        const rol = rolSnap.exists() ? rolSnap.data() : { nombre: '(sin categoría)', permisos: {} };
        return { usuario: u.usuario, nombre: u.nombre, rolId: u.rolId, rolNombre: rol.nombre, permisos: rol.permisos || {}, esAdmin: u.rolId === 'admin' };
    },

    /* El usuario conectado cambia su propia clave */
    async cambiarClave(actual, nueva, repetir) {
        if (!this.session) throw new Error('No hay sesión iniciada.');
        if (!actual || !nueva || !repetir) throw new Error('Completá los tres campos.');
        const ref = doc(db, getPath(USERS_COLLECTION_NAME), userId(this.session.usuario));
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Tu usuario ya no existe.');
        if (snap.data().clave !== actual) throw new Error('La clave actual es incorrecta.');
        if (!CLAVE_REGEX.test(nueva)) throw new Error(`La clave nueva debe tener la primera letra en mayúscula, luego minúsculas y 4 números. Ejemplo: ${CLAVE_EJEMPLO}`);
        if (nueva !== repetir) throw new Error('La clave nueva y su repetición no coinciden.');
        if (nueva === actual) throw new Error('La clave nueva debe ser distinta de la actual.');
        await updateDoc(ref, { clave: nueva });
    },

    async verifyAdminPassword(clave) {
        const snap = await getDocs(collection(db, getPath(USERS_COLLECTION_NAME)));
        return snap.docs.some(d => d.data().rolId === 'admin' && d.data().clave === clave);
    },

    async sembrarUsuariosIniciales() {
        const snap = await getDocs(collection(db, getPath(USERS_COLLECTION_NAME)));
        if (!snap.empty) return;
        let SEED;
        try { ({ SEED } = await import('./seed.js')); } catch (e) { console.warn('No se pudo cargar seed.js:', e); return; }   // sin seed.js no se carga nada
        for (const r of SEED.roles) await setDoc(doc(db, getPath(ROLES_COLLECTION_NAME), r.id), { nombre: r.nombre, permisos: r.permisos, sistema: !!r.sistema });
        for (const u of SEED.usuarios) await setDoc(doc(db, getPath(USERS_COLLECTION_NAME), userId(u.usuario)), { usuario: u.usuario, clave: u.clave, nombre: u.nombre, rolId: u.rolId });
    },

    async logout() {
        this.stopListeners();
        this.session = null;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* nada */ }
    },

    /* ---------- Administración de usuarios y categorías ---------- */
    async listUsers() {
        const snap = await getDocs(collection(db, getPath(USERS_COLLECTION_NAME)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    },
    async listRoles() {
        const snap = await getDocs(collection(db, getPath(ROLES_COLLECTION_NAME)));
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.id === 'admin' ? -1 : b.id === 'admin' ? 1 : a.nombre.localeCompare(b.nombre)));
    },
    /* originalId: id del usuario que se está editando (null si es nuevo). Permite cambiar el nombre de usuario. */
    async saveUser({ usuario, clave, nombre, rolId }, originalId = null) {
        const id = userId(usuario);
        if (!id || !clave || !nombre || !rolId) throw new Error('Completá usuario, clave, nombre real y categoría.');
        if (/\s/.test(id)) throw new Error('El usuario no puede tener espacios.');
        if (id !== originalId && (await getDoc(doc(db, getPath(USERS_COLLECTION_NAME), id))).exists()) throw new Error('Ya existe un usuario con ese nombre de usuario.');
        await setDoc(doc(db, getPath(USERS_COLLECTION_NAME), id), { usuario: usuario.trim(), clave, nombre: nombre.trim(), rolId });
        if (originalId && originalId !== id) await deleteDoc(doc(db, getPath(USERS_COLLECTION_NAME), originalId));
    },
    async deleteUser(id) {
        const users = await this.listUsers();
        const u = users.find(x => x.id === id);
        if (u?.rolId === 'admin' && users.filter(x => x.rolId === 'admin').length <= 1) throw new Error('No se puede borrar al único Admin.');
        if (id === this.session?.usuario.toLowerCase()) throw new Error('No podés borrar tu propio usuario mientras estás conectado.');
        await deleteDoc(doc(db, getPath(USERS_COLLECTION_NAME), id));
    },
    async saveRole({ id, nombre, permisos }) {
        const rid = id || slug(nombre);
        if (!rid || !nombre.trim()) throw new Error('Escribí el nombre de la categoría.');
        if (!id && (await getDoc(doc(db, getPath(ROLES_COLLECTION_NAME), rid))).exists()) throw new Error('Ya existe una categoría con ese nombre.');
        await setDoc(doc(db, getPath(ROLES_COLLECTION_NAME), rid), { nombre: nombre.trim(), permisos, sistema: rid === 'admin' });
        return rid;
    },
    async deleteRole(id) {
        if (id === 'admin') throw new Error('La categoría Admin no se puede borrar.');
        const users = await this.listUsers();
        const n = users.filter(u => u.rolId === id).length;
        if (n) throw new Error(`No se puede borrar: ${n} usuario(s) pertenecen a esta categoría. Movelos o borralos primero.`);
        await deleteDoc(doc(db, getPath(ROLES_COLLECTION_NAME), id));
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
    listenChecklist(callback, onError) {
        unsubChecklist?.();
        const q = query(collection(db, getPath(CHECKLIST_COLLECTION_NAME)), orderBy('orden', 'asc'));
        unsubChecklist = onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
    },
    async addChecklistItem(tarea) {
        if (!this.puedeEditarChecklist()) throw new Error('No tenés permiso para editar el Check List.');
        const texto = String(tarea || '').trim();
        if (!texto) throw new Error('Escribí la tarea.');
        return await addDoc(collection(db, getPath(CHECKLIST_COLLECTION_NAME)), { tarea: texto, orden: Date.now(), creadoPor: this.email, creadoEn: serverTimestamp() });
    },
    async updateChecklistItem(id, tarea) {
        if (!this.puedeEditarChecklist()) throw new Error('No tenés permiso para editar el Check List.');
        const texto = String(tarea || '').trim();
        if (!texto) throw new Error('La tarea no puede quedar vacía.');
        return await updateDoc(doc(db, getPath(CHECKLIST_COLLECTION_NAME), id), { tarea: texto, editadoPor: this.email, editadoEn: serverTimestamp() });
    },
    async deleteChecklistItem(id) {
        if (!this.puedeEditarChecklist()) throw new Error('No tenés permiso para editar el Check List.');
        return await deleteDoc(doc(db, getPath(CHECKLIST_COLLECTION_NAME), id));
    },
    /* Intercambia la posición de dos tareas (para subir / bajar) */
    async swapChecklistOrden(a, b) {
        if (!this.puedeEditarChecklist()) throw new Error('No tenés permiso para editar el Check List.');
        const batch = writeBatch(db);
        batch.update(doc(db, getPath(CHECKLIST_COLLECTION_NAME), a.id), { orden: b.orden });
        batch.update(doc(db, getPath(CHECKLIST_COLLECTION_NAME), b.id), { orden: a.orden });
        await batch.commit();
    },

    async inicializarCategoriasBase() {
        try {
            const configRef = doc(db, getPath('hotel_config'), 'categorias');
            const snap = await getDocs(collection(db, getPath('hotel_config')));
            if (snap.empty) {
                const options = ['Mantenimiento', 'HSKP', 'Front', 'Jefe Recepción', 'Gerencia', 'Reservas', 'Administración', 'Spa', 'Restaurante'];
                await setDoc(configRef, { options, creadoEn: serverTimestamp() });
            }
        } catch (e) { console.error(e); }
    },

    listenNovedades(callback, onError) {
        unsubNovedades?.();
        const fetchLimit = this.fetchLimit;
        const q = query(collection(db, getPath(COLLECTION_NAME)), orderBy('timestamp', 'desc'), limit(fetchLimit));
        unsubNovedades = onSnapshot(q, snap => {
            const items = [];
            snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            callback(items);
        }, onError);
    },

    listenAlarms(callback, onError) {
        unsubAlarms?.();
        const q = query(collection(db, getPath(ALARMS_COLLECTION_NAME)), orderBy('timestamp', 'desc'));
        unsubAlarms = onSnapshot(q, snap => {
            const items = [];
            snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            callback(items);
        }, onError);
    },

    async addNovedad(payload) {
        return await addDoc(collection(db, getPath(COLLECTION_NAME)), {
            ...payload, timestamp: serverTimestamp(), userId: this.user.uid,
            userEmail: this.email, userUsuario: this.session?.usuario || null, estado: 'Pendiente', comentarios: []
        });
    },

    async updateNovedad(id, payload) {
        return await updateDoc(doc(db, getPath(COLLECTION_NAME), id), {
            ...payload, lastEditedBy: this.email, lastEditedAt: serverTimestamp()
        });
    },

    async deleteNovedad(id) { return await deleteDoc(doc(db, getPath(COLLECTION_NAME), id)); },

    async changeEstadoNovedad(id, nuevoEstado) {
        const payload = { estado: nuevoEstado };
        if (nuevoEstado === 'Completado') {
            payload.completadoEn = serverTimestamp();
            payload.completadoPor = this.email;
        }
        return await updateDoc(doc(db, getPath(COLLECTION_NAME), id), payload);
    },

    async addComentario(id, text) {
        return await updateDoc(doc(db, getPath(COLLECTION_NAME), id), {
            comentarios: arrayUnion({ text, user: this.email, timestamp: new Date().toISOString() })
        });
    },

    async deleteAllNovedades() {
        const snap = await getDocs(collection(db, getPath(COLLECTION_NAME)));
        for (let i = 0; i < snap.docs.length; i += 400) {
            const batch = writeBatch(db);
            snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    },

    async addAlarm(alarmData) { return await addDoc(collection(db, getPath(ALARMS_COLLECTION_NAME)), { ...alarmData, timestamp: serverTimestamp() }); },
    async deleteAlarm(id) { return await deleteDoc(doc(db, getPath(ALARMS_COLLECTION_NAME), id)); }
};