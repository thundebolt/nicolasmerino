/* ==================================================================
   Demo de Retoque: reemplaza a WordPress (servidor, permisos y biblioteca de medios).
   El editor (retoque/editor.js y retoque/estilo.js) es el del plugin 1.13.1.
   Lo guardado y las notas se mantienen al pasar de una página a otra (sessionStorage),
   como en un sitio real. «Reiniciar la demo» deja todo como al principio.
   ================================================================== */
(function () {
  "use strict";

  var CLAVE = "retoque_demo_v2";
  var PAGINAS = { "index.html": "Inicio", "servicios.html": "Servicios", "contacto.html": "Contacto" };
  var IMAGENES = window.RETOQUE_DEMO_IMAGENES || [];
  var parametros = new URLSearchParams(window.location.search);

  // La portada siempre se llama index.html, para que las notas encuentren su página.
  if (/\/$/.test(window.location.pathname) && window.history && window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname + "index.html" + window.location.search + window.location.hash);
  }
  var carpeta = window.location.pathname.replace(/[^\/]*$/, "");
  var archivo = window.location.pathname.slice(carpeta.length) || "index.html";

  // ---------- Fechas como las escribe el plugin: "3 nov 2026 · 18:25" ----------
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  function fecha(d) {
    return d.getDate() + " " + MESES[d.getMonth()] + " " + d.getFullYear() + " · " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function hace(horas) { return fecha(new Date(Date.now() - horas * 3600 * 1000)); }

  function leer() {
    try { return JSON.parse(sessionStorage.getItem(CLAVE) || "null"); } catch (e) { return null; }
  }
  function escribir(estado) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) {}
  }

  // ?nuevo=1 (o el botón «Reiniciar la demo») empieza de cero.
  var rolPedido = parametros.get("rol");
  if (parametros.get("nuevo") === "1") {
    try {
      sessionStorage.removeItem(CLAVE);
      sessionStorage.removeItem("retoque_modo");
      sessionStorage.removeItem("retoque_estilo");
    } catch (e) {}
    parametros.delete("nuevo");
    if (window.history && window.history.replaceState) {
      var limpia = parametros.toString();
      window.history.replaceState(null, "", window.location.pathname + (limpia ? "?" + limpia : "") + window.location.hash);
    }
  }

  var estado = leer();
  if (!estado || (rolPedido && rolPedido !== estado.rol)) {
    estado = crearEstado(rolPedido === "desarrollador" ? "desarrollador" : "cliente");
    escribir(estado);
  }
  var esDesarrollador = estado.rol === "desarrollador";
  window.RETOQUE_DEMO_ROL = estado.rol;

  function rutaDe(nombre) { return "/" + (carpeta + nombre).replace(/^\/+|\/+$/g, ""); }
  function urlDe(nombre) { return new URL(nombre, window.location.href).href.split("?")[0].split("#")[0]; }
  var rutaAqui = rutaDe(archivo);

  function crearEstado(rol) {
    var notas = [];
    if (rol === "desarrollador") {
      // Notas que «ya mandó» la clienta, para mostrar el lado del equipo.
      notas = [
        { id: 87, texto: "¿Podemos usar una foto de nuestra camioneta en el banner? Te la mando por WhatsApp.", tocado: "Gasfitería en Concepción, con el precio claro antes de empezar", ubicacion: '[data-retoque="inicio_titulo"]', dx: 0.9, dy: 0.25, contenedor: "banner", pagina: "index.html", horas: 26 },
        { id: 88, texto: "Este es nuestro Instagram, que quede enlazado arriba y en el pie.", tocado: "Instagram", ubicacion: "#franja-instagram", dx: 0.5, dy: 0.5, contenedor: "franja", pagina: "index.html", horas: 25, enlace: "https://instagram.com/aguamarina.demo", red: "Instagram" },
        { id: 89, texto: "La mantención de calefont parte en $35.000.", tocado: "Mantención de calefont", ubicacion: '[data-retoque="servicios_s3_titulo"]', dx: 0.95, dy: 0.4, contenedor: "servicios", pagina: "servicios.html", horas: 24 }
      ].map(function (n) {
        return {
          id: n.id, texto: n.texto, estado: "pendiente", estado_nombre: "Enviada", autor: "Carolina (clienta)",
          fecha: hace(n.horas), tocado: n.tocado, ubicacion: n.ubicacion, dx: n.dx, dy: n.dy, contenedor: n.contenedor,
          enlace: n.enlace || "", red: n.red || "", ruta: rutaDe(n.pagina), titulo: PAGINAS[n.pagina], url: urlDe(n.pagina)
        };
      });
    }
    return { rol: rol, notas: notas, siguienteId: 101, hechas: 0, contenido: { claves: {}, listas: {}, fondos: {} } };
  }

  function contar(paso) {
    try { if (window.parent !== window) window.parent.postMessage({ retoqueDemo: paso }, "*"); } catch (e) {}
  }

  // ---------- Valor de diseño de cada campo (para «↺ Original») ----------
  Array.prototype.forEach.call(document.querySelectorAll("[data-retoque]"), function (el) {
    if (el.hasAttribute("data-retoque-defecto")) return;
    var tipo = el.getAttribute("data-retoque-tipo");
    if (tipo === "imagen") el.setAttribute("data-retoque-defecto", el.getAttribute("src"));
    else if (tipo === "enlace") {
      el.setAttribute("data-retoque-defecto", (el.querySelector(".retoque-enlace-texto") || el).textContent.trim());
      el.setAttribute("data-retoque-defecto-url", el.getAttribute("data-retoque-url") || "");
    } else if (tipo === "opcion") el.setAttribute("data-retoque-defecto", el.getAttribute("data-retoque-valor"));
    else if (tipo === "formato") el.setAttribute("data-retoque-defecto", el.innerHTML.trim());
    else el.setAttribute("data-retoque-defecto", el.textContent.trim());
  });

  // ---------- Contenido guardado: se toma una foto del contenido y se repone en cada página ----------
  var CLASES_EDITOR = /^retoque-(modificado|seleccionado|falta-destello|objetivo|estilo-[\w-]+)$/;
  function limpiar(nodo) {
    Array.prototype.forEach.call(nodo.querySelectorAll(".retoque-controles-item, .retoque-agregar, .retoque-chip, .retoque-pin, .retoque-panel"), function (n) { n.remove(); });
    [nodo].concat(Array.prototype.slice.call(nodo.querySelectorAll("*"))).forEach(function (n) {
      n.removeAttribute("contenteditable");
      if (n.hasAttribute("data-retoque") || n.hasAttribute("data-retoque-item")) { n.removeAttribute("tabindex"); n.removeAttribute("spellcheck"); }
      Array.prototype.slice.call(n.classList).forEach(function (c) { if (CLASES_EDITOR.test(c)) n.classList.remove(c); });
      if (n.getAttribute("class") === "") n.removeAttribute("class");
    });
    return nodo;
  }
  function fotografiar() {
    var c = estado.contenido;
    Array.prototype.forEach.call(document.querySelectorAll("[data-retoque-lista]"), function (lista) {
      c.listas[lista.getAttribute("data-retoque-lista")] = limpiar(lista.cloneNode(true)).innerHTML;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-retoque]"), function (el) {
      if (el.closest("[data-retoque-lista]")) return;
      var copia = limpiar(el.cloneNode(true));
      var datos = { html: copia.innerHTML, atributos: {} };
      ["src", "alt", "href", "data-retoque-url", "data-retoque-valor", "class"].forEach(function (a) {
        if (copia.hasAttribute(a)) datos.atributos[a] = copia.getAttribute(a);
      });
      c.claves[el.getAttribute("data-retoque")] = datos;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-retoque-fondo]"), function (el) {
      c.fondos[el.getAttribute("data-retoque-fondo")] = { fondo: el.style.getPropertyValue("--retoque-imagen-fondo"), con: el.hasAttribute("data-retoque-con-fondo") };
    });
    escribir(estado);
  }
  (function reponer() {
    var c = estado.contenido;
    Object.keys(c.listas).forEach(function (nombre) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-retoque-lista="' + nombre + '"]'), function (lista) { lista.innerHTML = c.listas[nombre]; });
    });
    Object.keys(c.claves).forEach(function (clave) {
      var datos = c.claves[clave];
      Array.prototype.forEach.call(document.querySelectorAll('[data-retoque="' + clave + '"]'), function (el) {
        if (el.closest("[data-retoque-lista]")) return;
        if (el.tagName !== "IMG") el.innerHTML = datos.html;
        Object.keys(datos.atributos).forEach(function (a) { el.setAttribute(a, datos.atributos[a]); });
      });
    });
    Object.keys(c.fondos).forEach(function (clave) {
      var f = c.fondos[clave];
      Array.prototype.forEach.call(document.querySelectorAll('[data-retoque-fondo="' + clave + '"]'), function (el) {
        if (f.fondo) el.style.setProperty("--retoque-imagen-fondo", f.fondo); else el.style.removeProperty("--retoque-imagen-fondo");
        if (f.con) el.setAttribute("data-retoque-con-fondo", ""); else el.removeAttribute("data-retoque-con-fondo");
      });
    });
  })();

  // ---------- Servidor simulado ----------
  function porEnviar() { return estado.notas.filter(function (n) { return n.estado === "borrador"; }).length; }

  function responder(cuerpo, codigo) {
    return new Promise(function (resolver) {
      setTimeout(function () {
        resolver(new Response(JSON.stringify(cuerpo), { status: codigo || 200, headers: { "Content-Type": "application/json" } }));
      }, 420);
    });
  }

  function servidor(url, opciones) {
    var camino = url.replace(/^demo-retoque\//, "");
    if (camino === "guardar") {
      var cuerpo = {};
      try { cuerpo = JSON.parse(opciones.body || "{}"); } catch (e) {}
      var cambios = cuerpo.cambios || [];
      // La foto se toma justo después de que el editor da por guardado (sus clases ya se quitaron).
      setTimeout(fotografiar, 600);
      contar("guardar");
      if (cambios.some(function (c) { return document.querySelector('[data-retoque-fondo="' + c.clave + '"]'); })) contar("fondo");
      return responder({ ok: true, errores: [] });
    }
    if (camino === "estilos") {
      contar("estilo");
      return responder({ ok: true });
    }
    if (camino === "notas" && opciones.body instanceof FormData) {
      var f = opciones.body;
      var archivo = f.get("imagen");
      var nota = {
        id: estado.siguienteId++,
        texto: String(f.get("texto") || ""),
        estado: "borrador",
        estado_nombre: "Por enviar",
        autor: esDesarrollador ? "Nicolás (desarrollador)" : "Tú",
        fecha: fecha(new Date()),
        tocado: String(f.get("texto_elemento") || ""),
        ubicacion: String(f.get("ubicacion") || ""),
        dx: parseFloat(f.get("dx")) || 0,
        dy: parseFloat(f.get("dy")) || 0,
        contenedor: String(f.get("contenedor") || ""),
        enlace: String(f.get("enlace") || ""),
        red: String(f.get("red") || ""),
        ruta: rutaAqui,
        titulo: PAGINAS[archivo] || document.title,
        url: urlDe(archivo)
      };
      if (archivo && archivo.size) {
        try { nota.imagen = URL.createObjectURL(archivo); } catch (e) {}
      }
      estado.notas.push(nota);
      escribir(estado);
      contar("nota");
      if (nota.enlace) contar("enlace");
      return responder({ nota: nota, por_enviar: porEnviar() });
    }
    if (camino === "notas/lista") {
      var grupos = [];
      Object.keys(PAGINAS).forEach(function (nombre) {
        var ruta = rutaDe(nombre);
        var deEsta = estado.notas.filter(function (n) { return n.ruta === ruta && n.estado !== "hecho"; });
        if (deEsta.length) grupos.push({ ruta: ruta, titulo: PAGINAS[nombre], url: urlDe(nombre), notas: deEsta });
      });
      return responder({
        grupos: grupos,
        por_enviar: porEnviar(),
        enviadas: estado.notas.filter(function (n) { return n.estado === "pendiente"; }).length,
        hechas: estado.hechas
      });
    }
    if (camino === "notas/enviar") {
      var enviadas = 0;
      estado.notas.forEach(function (n) { if (n.estado === "borrador") { n.estado = "pendiente"; n.estado_nombre = "Enviada"; enviadas++; } });
      escribir(estado);
      contar("enviar");
      return responder({ enviadas: enviadas, correo: true });
    }
    var coincide = /^notas\/(\d+)$/.exec(camino);
    if (coincide) {
      var id = parseInt(coincide[1], 10);
      var datosNota = {};
      try { datosNota = JSON.parse(opciones.body || "{}"); } catch (e) {}
      var objetivo = estado.notas.filter(function (n) { return n.id === id; })[0];
      if (!objetivo) return responder({ message: "Esa nota ya no existe." }, 404);
      if (datosNota.accion === "borrar") {
        estado.notas = estado.notas.filter(function (n) { return n.id !== id; });
      } else if (datosNota.accion === "editar") {
        objetivo.texto = String(datosNota.texto || objetivo.texto);
        if (datosNota.enlace !== undefined) objetivo.enlace = String(datosNota.enlace || "");
      } else if (datosNota.estado === "hecho") {
        objetivo.estado = "hecho"; objetivo.estado_nombre = "Hecha"; estado.hechas++;
        contar("hecha");
      }
      escribir(estado);
      return responder({ ok: true, por_enviar: porEnviar() });
    }
    return responder({ message: "Ruta desconocida en la demo." }, 404);
  }

  var fetchOriginal = window.fetch.bind(window);
  window.fetch = function (url, opciones) {
    if (typeof url === "string" && url.indexOf("demo-retoque/") === 0) return servidor(url, opciones || {});
    return fetchOriginal(url, opciones);
  };

  // ---------- Datos que WordPress le pasa al editor ----------
  window.RetoqueDatos = {
    api: "demo-retoque/guardar",
    apiNotas: "demo-retoque/notas",
    apiLista: "demo-retoque/notas/lista",
    apiEnviar: "demo-retoque/notas/enviar",
    nonce: "demo",
    pagina: 0,
    desarrollador: esDesarrollador,
    listas: true,
    notas: estado.notas.filter(function (n) { return n.ruta === rutaAqui && n.estado !== "hecho"; }),
    notasActivas: true,
    soloNotas: false,
    pedirNombre: false,
    correoAviso: esDesarrollador ? "" : "carolina@example.com",
    revision: "",
    porEnviar: porEnviar()
  };
  window.RetoqueEstilo = {
    api: "demo-retoque/estilos",
    nonce: "demo",
    estilos: { colores: {}, reglas: {} },
    vista: archivo.replace(/\.html$/, ""),
    corte: 767
  };

  // ---------- Biblioteca de medios simulada (wp.media) ----------
  window.wp = {
    media: function (opciones) {
      var alElegir = [];
      var elegida = null;
      var marco = {
        on: function (evento, fn) { if (evento === "select") alElegir.push(fn); },
        state: function () { return { get: function () { return { first: function () { return { toJSON: function () { return elegida; } }; } }; } }; },
        open: function () {
          var fondo = document.createElement("div");
          fondo.className = "media-modal-backdrop";
          var caja = document.createElement("div");
          caja.className = "media-modal";
          caja.setAttribute("role", "dialog");
          caja.setAttribute("aria-modal", "true");
          caja.setAttribute("aria-label", opciones.title || "Elegir imagen");
          caja.innerHTML =
            '<div class="media-modal__cabeza"><h2></h2><button type="button" class="media-modal__cerrar" aria-label="Cerrar">✕</button></div>' +
            '<div class="media-modal__pestanas"><span>Subir archivos</span><span class="es-actual">Biblioteca de medios</span></div>' +
            '<div class="media-modal__grilla"></div>' +
            '<div class="media-modal__pie"><span class="media-modal__nota">En el sitio real es la biblioteca de WordPress: ahí subes tus propias fotos.</span><button type="button" class="media-modal__usar" disabled></button></div>';
          caja.querySelector("h2").textContent = opciones.title || "Elegir imagen";
          var usar = caja.querySelector(".media-modal__usar");
          usar.textContent = (opciones.button && opciones.button.text) || "Usar esta imagen";
          var grilla = caja.querySelector(".media-modal__grilla");
          IMAGENES.forEach(function (imagen, i) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "media-modal__item";
            b.setAttribute("aria-pressed", "false");
            b.setAttribute("aria-label", imagen.alt);
            b.setAttribute("data-archivo", imagen.url);
            var img = document.createElement("img");
            img.src = imagen.url;
            img.alt = "";
            b.appendChild(img);
            b.addEventListener("click", function () {
              Array.prototype.forEach.call(grilla.children, function (o) { o.setAttribute("aria-pressed", "false"); });
              b.setAttribute("aria-pressed", "true");
              elegida = { id: 500 + i, url: imagen.url, alt: imagen.alt, sizes: {} };
              usar.disabled = false;
            });
            b.addEventListener("dblclick", function () { usar.click(); });
            grilla.appendChild(b);
          });
          function cerrar() { fondo.remove(); caja.remove(); document.removeEventListener("keydown", alTecla); }
          function alTecla(e) { if (e.key === "Escape") cerrar(); }
          caja.querySelector(".media-modal__cerrar").addEventListener("click", cerrar);
          fondo.addEventListener("click", cerrar);
          usar.addEventListener("click", function () {
            if (!elegida) return;
            cerrar();
            alElegir.forEach(function (fn) { fn(); });
          });
          document.addEventListener("keydown", alTecla);
          document.body.appendChild(fondo);
          document.body.appendChild(caja);
          caja.querySelector(".media-modal__item").focus();
        }
      };
      return marco;
    }
  };

  // ---------- Avisos propios de la demo ----------
  function avisoDemo(texto) {
    var caja = document.createElement("div");
    caja.className = "retoque-aviso retoque-aviso--ok";
    caja.setAttribute("role", "status");
    caja.textContent = texto;
    document.body.appendChild(caja);
    setTimeout(function () { caja.classList.add("es-visible"); }, 10);
    setTimeout(function () { caja.classList.remove("es-visible"); setTimeout(function () { caja.remove(); }, 300); }, 3000);
  }
  function editando() {
    var c = document.body.classList;
    return c.contains("retoque-activo") || c.contains("retoque-comentando") || c.contains("retoque-estilando");
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Fuera de los modos, los enlaces externos no salen de la demo.
    document.addEventListener("click", function (e) {
      var enlace = e.target.closest && e.target.closest('a[href^="http"], a[href^="tel:"], a[href^="mailto:"]');
      if (!enlace || editando()) return;
      if (enlace.closest(".retoque-barra, .retoque-panel, .retoque-cajon, .retoque-pin-detalle, .media-modal")) return;
      e.preventDefault();
      avisoDemo("En la demo este botón no sale del sitio. Lleva a: " + enlace.getAttribute("href"));
    });
    // El formulario de contacto no envía nada.
    Array.prototype.forEach.call(document.querySelectorAll("form.formulario"), function (formulario) {
      formulario.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!editando()) avisoDemo("En la demo el formulario no envía mensajes.");
      });
    });
    // Reiniciar la demo.
    Array.prototype.forEach.call(document.querySelectorAll("[data-reiniciar-demo]"), function (boton) {
      boton.addEventListener("click", function () {
        window.location.href = "index.html?nuevo=1&rol=" + estado.rol;
      });
    });
    new MutationObserver(function () {
      if (document.body.classList.contains("retoque-activo")) contar("editar");
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    contar("pagina:" + archivo);
  });
})();
