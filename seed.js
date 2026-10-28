/* =====================================================================
   seed.js — Datos iniciales (se cargan UNA sola vez, cuando la base de
   usuarios está vacía). Después de la primera ejecución podés borrar
   este archivo: las claves quedan solo en Firestore y se gestionan
   desde el módulo Administración.
   ===================================================================== */
const TODOS = ['crear', 'editar', 'borrar', 'estado', 'comentar', 'alarmas', 'whatsapp', 'excel', 'pdf', 'borrarTodo'];
const permisos = lista => Object.fromEntries(TODOS.map(k => [k, lista.includes(k)]));

export const SEED = {
    roles: [
        { id: 'admin', nombre: 'Admin', sistema: true, permisos: permisos(TODOS) },
        { id: 'gerencia', nombre: 'Gerencia', permisos: permisos(TODOS) },
        { id: 'jefe-recepcion', nombre: 'Jefe Recepción', permisos: permisos(TODOS) },
        { id: 'recepcionista', nombre: 'Recepcionista', permisos: permisos(['crear', 'editar', 'estado', 'comentar', 'whatsapp']) }
    ],
    usuarios: [
        { usuario: 'VLLORCA',  clave: 'Victor1144',  nombre: 'Admin',             rolId: 'admin' },
        { usuario: 'bvaleria', clave: 'Valeria8963', nombre: 'Bakota Valeria',    rolId: 'gerencia' },
        { usuario: 'crodigo',  clave: 'Rodrigo1478', nombre: 'Castro Rodrigo',    rolId: 'jefe-recepcion' },
        { usuario: 'lvictor',  clave: 'Victor1144',  nombre: 'Llorca Victor',     rolId: 'recepcionista' },
        { usuario: 'psergio',  clave: 'Sergio1144',  nombre: 'Perez Sergio',      rolId: 'recepcionista' },
        { usuario: 'trodigo',  clave: 'Rodrigo1144', nombre: 'Tula Rodrigo',      rolId: 'recepcionista' },
        { usuario: 'bdavid',   clave: 'David1144',   nombre: 'Bulfon David',      rolId: 'recepcionista' },
        { usuario: 'abruno',   clave: 'Bruno1144',   nombre: 'Alesandro Bruno',   rolId: 'recepcionista' },
        { usuario: 'cdiamela', clave: 'Diame1144',   nombre: 'Consenza Diamela',  rolId: 'recepcionista' }
    ]
};
