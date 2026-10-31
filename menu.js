/* =====================================================================
   menu.js — Menú sándwich común a TODAS las páginas del hotel
   ---------------------------------------------------------------------
   · La lista de páginas está acá, en un solo lugar: para agregar una
     página nueva al menú de todas, se agrega UNA línea en PAGINAS.
   · Cada lugar marcado con  data-menu-slot  en el HTML recibe el botón.
   · La página donde estás aparece marcada con un tilde.
   ===================================================================== */
(function () {
    var PAGINAS = [
        { href: 'index.html',         texto: 'Registro Diario',  icono: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
        { href: 'reservas-spa.html',  texto: 'Reservas de Spa',  icono: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
        { href: 'checklist.html',     texto: 'Checklist Diario', icono: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012-2m-6 9l2 2 4-4' },
        { href: 'panelreservas.html', texto: 'Panel de Reservas', icono: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' }
    ];
    var NS = 'http://www.w3.org/2000/svg';

    function archivoActual() {
        var f = decodeURIComponent((location.pathname.split('/').pop() || '')).toLowerCase();
        return f || 'index.html';
    }

    function svg(d, clase) {
        var s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
        s.setAttribute('aria-hidden', 'true'); if (clase) s.setAttribute('class', clase);
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('d', d);
        s.appendChild(p); return s;
    }

    var todos = [];
    function cerrarTodos(salvo) {
        todos.forEach(function (m) { if (m !== salvo) cerrar(m); });
    }
    function cerrar(m) { m.menu.hidden = true; m.btn.setAttribute('aria-expanded', 'false'); }

    function construir(slot, n) {
        var actual = archivoActual();
        var cont = document.createElement('div');
        cont.className = 'sandwich-menu-container' + (slot.getAttribute('data-sobre') === 'oscuro' ? ' menu-sobre-oscuro' : '');

        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'sandwich-btn';
        btn.id = 'sandwich-btn-' + n;
        btn.setAttribute('aria-label', 'Menú de navegación');
        btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', 'sandwich-menu-' + n);
        btn.appendChild(svg('M4 6h16M4 12h16M4 18h16', 'sandwich-icon'));

        var menu = document.createElement('div');
        menu.id = 'sandwich-menu-' + n; menu.className = 'sandwich-dropdown'; menu.hidden = true;
        menu.setAttribute('role', 'menu');

        PAGINAS.forEach(function (p) {
            var a = document.createElement('a');
            a.href = p.href; a.setAttribute('role', 'menuitem');
            var esActual = p.href.toLowerCase() === actual;
            if (esActual) { a.className = 'es-actual'; a.setAttribute('aria-current', 'page'); }
            a.appendChild(svg(p.icono));
            var t = document.createElement('span'); t.className = 'menu-texto'; t.textContent = p.texto; a.appendChild(t);
            if (esActual) { var ok = document.createElement('span'); ok.className = 'menu-actual'; ok.textContent = '✓'; a.appendChild(ok); }
            menu.appendChild(a);
        });

        cont.appendChild(btn); cont.appendChild(menu);
        slot.appendChild(cont);

        var m = { btn: btn, menu: menu };
        todos.push(m);
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var abrir = menu.hidden;
            cerrarTodos(m);
            menu.hidden = !abrir;
            btn.setAttribute('aria-expanded', String(abrir));
        });
    }

    function iniciar() {
        var slots = document.querySelectorAll('[data-menu-slot]');
        for (var i = 0; i < slots.length; i++) construir(slots[i], i + 1);
        document.addEventListener('click', function (e) {
            todos.forEach(function (m) { if (!m.btn.contains(e.target) && !m.menu.contains(e.target)) cerrar(m); });
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarTodos(null); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
