import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, 
    setPersistence, browserSessionPersistence, signOut, 
    signInAnonymously, signInWithCustomToken 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { 
    getFirestore, doc, setDoc, onSnapshot, collection, query, 
    orderBy, limit, serverTimestamp, updateDoc, addDoc, 
    getDocs, deleteDoc, writeBatch, arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

const isCanvasEnvironment = typeof __app_id !== 'undefined';
const appId = isCanvasEnvironment ? __app_id : 'default-hotel-app'; 
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

let db, auth;
const COLLECTION_NAME = 'hotel_log'; 
const ALARMS_COLLECTION_NAME = 'hotel_alarms';
const getPath = (colName) => isCanvasEnvironment ? `artifacts/${appId}/public/data/${colName}` : colName;

let unsubNovedades = null;
let unsubAlarms = null;

export const FirebaseService = {
    user: null,

    // Máximo de registros que se leen (se define en config.js)
    get fetchLimit() { return window.APP_CONFIG?.FIRESTORE_FETCH_LIMIT || 200; },
    // Email del usuario con valor de respaldo (las cuentas anónimas no tienen email)
    get email() { return this.user?.email || 'usuario-prueba@hotel545.com'; },

    async init(onAuthSuccess, onAuthError) {
        // La configuración se lee aquí (no al importar) para poder mostrar un error claro si falta config.js
        const firebaseConfig = window.APP_CONFIG?.FIREBASE_CONFIG;
        if (!firebaseConfig) throw new Error('config.js no se cargó o no define FIREBASE_CONFIG.');
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        if (isCanvasEnvironment) {
            if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken).catch(() => signInAnonymously(auth));
            else await signInAnonymously(auth);
        } else {
            await setPersistence(auth, browserSessionPersistence);
        }

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.user = user;
                this.stopListeners();   // evita suscripciones duplicadas si el estado se dispara de nuevo
                await this.inicializarCategoriasBase();
                onAuthSuccess(user);
            } else {
                this.user = null;
                this.stopListeners();
                onAuthError();
            }
        });
    },

    async login(email, password) { return await signInWithEmailAndPassword(auth, email, password); },
    async logout() { this.stopListeners(); return await signOut(auth); },

    stopListeners() {
        unsubNovedades?.(); unsubAlarms?.();
        unsubNovedades = unsubAlarms = null;
    },

    async inicializarCategoriasBase() {
        try {
            const configRef = doc(db, getPath('hotel_config'), 'categorias');
            const snap = await getDocs(collection(db, getPath('hotel_config')));
            if (snap.empty) {
                const options = ['Mantenimiento', 'HSKP', 'ReservasHA', 'ReservasHE', 'Front', 'Jefe Recepción', 'Seguridad', 'Parking', 'A.Públicas', 'Piscina', 'GerenciaO', 'GerenciaD'];
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
            userEmail: this.email, estado: 'En curso', comentarios: []
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