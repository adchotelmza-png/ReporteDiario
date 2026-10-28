/* =====================================================================
   admin.js — Módulo de administración de usuarios y categorías
   Solo visible para el Admin y protegido con la clave del Admin.
   ===================================================================== */
import { FirebaseService, PERMISOS } from './firebase-service.js';

const $ = id => document.getElementById(id);
const esc = str => !str ? '' : String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

let UI = null, tab = 'usuarios', users = [], roles = [], editingUser = null, editingRole = null;

export const AdminPanel = {
    init(ui) {
        UI = ui;
        $('open-admin-btn').addEventListener('click', () => this.openGate());
        $('admin-gate-confirm').addEventListener('click', () => this.checkGate());
        $('admin-gate-password').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.checkGate(); } });
        $('admin-tabs').addEventListener('click', e => {
            const b = e.target.closest('[data-tab]');
            if (!b) return;
            tab = b.dataset.tab; editingUser = editingRole = null; this.msg(''); this.render();
        });
        $('admin-body').addEventListener('click', e => this.onClick(e));
        $('admin-body').addEventListener('submit', e => this.onSubmit(e));
    },

    openGate() {
        if (!FirebaseService.session?.esAdmin) return;
        $('admin-gate-password').value = '';
        $('admin-gate-error').classList.add('hidden');
        UI.openModal($('admin-gate-modal'), 'admin-gate-password');
    },

    async checkGate() {
        const btn = $('admin-gate-confirm');
        btn.disabled = true;
        try {
            if (!(await FirebaseService.verifyAdminPassword($('admin-gate-password').value))) {
                $('admin-gate-error').classList.remove('hidden');
                return;
            }
            UI.closeModal($('admin-gate-modal'));
            $('admin-gate-password').value = '';
            tab = 'usuarios'; editingUser = editingRole = null; this.msg('');
            UI.openModal($('admin-modal'));
            await this.refresh();
        } catch (err) { UI.showMessage('Error', err.message); }
        finally { btn.disabled = false; }
    },

    async refresh() {
        $('admin-body').innerHTML = '<p class="admin-empty">Cargando...</p>';
        try { [users, roles] = await Promise.all([FirebaseService.listUsers(), FirebaseService.listRoles()]); }
        catch (err) { return this.msg('No se pudieron cargar los datos: ' + err.message); }
        this.render();
    },

    msg(text, ok = false) {
        const el = $('admin-msg');
        el.textContent = text;
        el.style.color = ok ? '#10b981' : '';
        el.classList.toggle('hidden', !text);
    },

    render() {
        document.querySelectorAll('#admin-tabs [data-tab]').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
        $('admin-body').innerHTML = tab === 'usuarios' ? this.htmlUsers() : this.htmlRoles();
    },

    rolNombre: id => roles.find(r => r.id === id)?.nombre || '(sin categoría)',

    /* ---------- Usuarios ---------- */
    htmlUsers() {
        const u = editingUser ? users.find(x => x.id === editingUser) : null;
        const rows = users.map(x => `
            <tr>
                <td>${esc(x.nombre)}</td><td>${esc(x.usuario)}</td><td>${esc(x.clave)}</td><td>${esc(this.rolNombre(x.rolId))}</td>
                <td class="admin-actions">
                    <button type="button" class="button button-secondary" data-act="edit-user" data-id="${esc(x.id)}">Editar</button>
                    <button type="button" class="button button-danger" data-act="del-user" data-id="${esc(x.id)}">Borrar</button>
                </td>
            </tr>`).join('');
        return `
            <div class="admin-scroll"><table class="admin-table">
                <thead><tr><th>Nombre real</th><th>Usuario</th><th>Clave</th><th>Categoría</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" class="admin-empty">No hay usuarios.</td></tr>'}</tbody>
            </table></div>
            <form id="admin-user-form" class="admin-form" autocomplete="off">
                <h4>${u ? 'Editar usuario' : 'Nuevo usuario'}</h4>
                <div class="admin-grid">
                    <div class="form-group"><label class="form-label" for="au-nombre">Nombre real (se usa en los registros)</label>
                        <input id="au-nombre" class="form-input" required placeholder="Ej: Castro Rodrigo" value="${esc(u?.nombre)}"></div>
                    <div class="form-group"><label class="form-label" for="au-usuario">Usuario</label>
                        <input id="au-usuario" class="form-input" required placeholder="Ej: crodigo" value="${esc(u?.usuario)}"></div>
                    <div class="form-group"><label class="form-label" for="au-clave">Clave</label>
                        <input id="au-clave" class="form-input" required value="${esc(u?.clave)}"></div>
                    <div class="form-group"><label class="form-label" for="au-rol">Categoría</label>
                        <select id="au-rol" class="form-select">${roles.map(r => `<option value="${esc(r.id)}" ${u?.rolId === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>
                </div>
                <div class="admin-form-actions">
                    ${u ? '<button type="button" class="button button-gray" data-act="cancel-user">Cancelar edición</button>' : ''}
                    <button type="submit" class="button button-primary">${u ? 'Guardar cambios' : 'Agregar usuario'}</button>
                </div>
            </form>`;
    },

    /* ---------- Categorías ---------- */
    htmlRoles() {
        const r = editingRole ? roles.find(x => x.id === editingRole) : null;
        const isAdminRole = r?.id === 'admin';
        const rows = roles.map(x => {
            const n = users.filter(u => u.rolId === x.id).length;
            const activos = x.id === 'admin' ? 'Todos' : PERMISOS.filter(p => x.permisos?.[p.k]).length + ' de ' + PERMISOS.length;
            return `<tr>
                <td>${esc(x.nombre)}</td><td>${n}</td><td>${activos}</td>
                <td class="admin-actions">
                    <button type="button" class="button button-secondary" data-act="edit-role" data-id="${esc(x.id)}">Editar</button>
                    ${x.id === 'admin' ? '' : `<button type="button" class="button button-danger" data-act="del-role" data-id="${esc(x.id)}">Borrar</button>`}
                </td></tr>`;
        }).join('');
        return `
            <div class="admin-scroll"><table class="admin-table">
                <thead><tr><th>Categoría</th><th>Usuarios</th><th>Permisos activos</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <form id="admin-role-form" class="admin-form" autocomplete="off">
                <h4>${r ? 'Editar categoría' : 'Nueva categoría'}</h4>
                <div class="form-group"><label class="form-label" for="ar-nombre">Nombre de la categoría</label>
                    <input id="ar-nombre" class="form-input" required placeholder="Ej: Supervisor" value="${esc(r?.nombre)}" ${isAdminRole ? 'readonly' : ''}></div>
                <p class="form-label" style="margin: .75rem 0 .35rem;">Permisos${isAdminRole ? ' (el Admin siempre tiene todos)' : ''}</p>
                <div class="admin-perms">${PERMISOS.map(p => `
                    <label class="admin-perm"><input type="checkbox" data-perm="${p.k}" ${isAdminRole || r?.permisos?.[p.k] ? 'checked' : ''} ${isAdminRole ? 'disabled' : ''}><span>${esc(p.label)}</span></label>`).join('')}
                </div>
                <p class="admin-hint">Todas las categorías pueden ver los registros. Los cambios de permisos se aplican cuando el usuario vuelve a iniciar sesión.</p>
                <div class="admin-form-actions">
                    ${r ? '<button type="button" class="button button-gray" data-act="cancel-role">Cancelar edición</button>' : ''}
                    <button type="submit" class="button button-primary">${r ? 'Guardar cambios' : 'Agregar categoría'}</button>
                </div>
            </form>`;
    },

    async onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = b.dataset.id;
        this.msg('');
        try {
            switch (b.dataset.act) {
                case 'edit-user': editingUser = id; this.render(); $('au-nombre').focus(); break;
                case 'cancel-user': editingUser = null; this.render(); break;
                case 'del-user': {
                    const u = users.find(x => x.id === id);
                    if (!confirm(`¿Borrar al usuario "${u?.nombre}" (${u?.usuario})?`)) return;
                    await FirebaseService.deleteUser(id); editingUser = null; await this.refresh(); this.msg('Usuario borrado.', true); break;
                }
                case 'edit-role': editingRole = id; this.render(); $('ar-nombre').focus(); break;
                case 'cancel-role': editingRole = null; this.render(); break;
                case 'del-role': {
                    const r = roles.find(x => x.id === id);
                    if (!confirm(`¿Borrar la categoría "${r?.nombre}"?`)) return;
                    await FirebaseService.deleteRole(id); editingRole = null; await this.refresh(); this.msg('Categoría borrada.', true); break;
                }
            }
        } catch (err) { this.msg(err.message); }
    },

    async onSubmit(e) {
        e.preventDefault();
        this.msg('');
        try {
            if (e.target.id === 'admin-user-form') {
                const wasEditing = !!editingUser;
                await FirebaseService.saveUser({
                    usuario: $('au-usuario').value, clave: $('au-clave').value, nombre: $('au-nombre').value, rolId: $('au-rol').value
                }, editingUser);
                editingUser = null; await this.refresh(); this.msg(wasEditing ? 'Usuario actualizado.' : 'Usuario agregado.', true);
            } else if (e.target.id === 'admin-role-form') {
                const permisos = Object.fromEntries(PERMISOS.map(p => [p.k, !!e.target.querySelector(`[data-perm="${p.k}"]`).checked]));
                const wasEditing = !!editingRole;
                await FirebaseService.saveRole({ id: editingRole, nombre: $('ar-nombre').value, permisos });
                editingRole = null; await this.refresh(); this.msg(wasEditing ? 'Categoría actualizada.' : 'Categoría agregada.', true);
            }
        } catch (err) { this.msg(err.message); }
    }
};
