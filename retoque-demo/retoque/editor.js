/**
 * Retoque · Editor en vivo
 *
 * Modo "Editar": vuelve editables los elementos marcados con data-retoque="clave" y
 * data-retoque-tipo (texto, parrafo, formato, imagen, enlace, opcion), y las listas
 * marcadas con data-retoque-lista. Junta los cambios y los guarda de una vez.
 *
 * Modo "Comentar": quien edita toca cualquier parte y deja una nota para el equipo.
 *
 * Solo los desarrolladores ven los contenedores (data-contenedor) y pueden marcar notas como hechas.
 */
( function () {
	'use strict';

	var datos = window.RetoqueDatos || {};
	var CLAVE_SESION = 'retoque_modo';
	var MAX_IMAGEN = 8 * 1024 * 1024;

	var estado = {
		modo: '',            // '' | 'editar' | 'comentar'
		seleccionado: null,
		cambios: {},         // id -> { clave, tipo, valor, pagina, restablecer }
		originales: {},      // id -> estado inicial de cada campo, para descartar
		listas: {},          // id -> { lista, nodos } orden inicial de cada lista
		guardando: false,
		verContenedores: false,
		notas: Array.isArray( datos.notas ) ? datos.notas.slice() : [],
		porEnviar: parseInt( datos.porEnviar, 10 ) || 0,
		enviandoNota: false
	};

	var ui = {};

	/* ------------------------------------------------------------------
	 * Utilidades
	 * ---------------------------------------------------------------- */

	function crear( etiqueta, clase, texto ) {
		var el = document.createElement( etiqueta );
		if ( clase ) { el.className = clase; }
		if ( texto ) { el.textContent = texto; }
		return el;
	}

	function boton( clase, texto, alHacer ) {
		var b = crear( 'button', clase, texto );
		b.type = 'button';
		if ( alHacer ) { b.addEventListener( 'click', alHacer ); }
		return b;
	}

	function paginaDe( el ) {
		return el.getAttribute( 'data-retoque-pagina' ) || '0';
	}

	function idCambio( clave, pagina, tipo ) {
		return ( tipo === 'lista' ? 'L' : '' ) + ( pagina || '0' ) + '|' + clave;
	}

	function elementosDe( clave, pagina ) {
		return Array.prototype.filter.call(
			document.querySelectorAll( '[data-retoque="' + clave + '"]' ),
			function ( el ) { return paginaDe( el ) === String( pagina || '0' ); }
		);
	}

	/* Fondos (v1.11): contenedores con imagen de fondo editable */
	function esFondo( el ) {
		return !! el && el.hasAttribute( 'data-retoque-fondo' ) && ! el.hasAttribute( 'data-retoque' );
	}

	function fondosDe( clave, pagina ) {
		return Array.prototype.filter.call(
			document.querySelectorAll( '[data-retoque-fondo="' + clave + '"]' ),
			function ( el ) { return paginaDe( el ) === String( pagina || '0' ); }
		);
	}

	/** Lo editable que hay detrás del punto tocado: un fondo de contenedor o una imagen tapada por el texto. */
	function fondoEn( x, y ) {
		if ( ! document.elementsFromPoint ) { return null; }
		var pila = document.elementsFromPoint( x, y );
		for ( var i = 0; i < pila.length; i++ ) {
			if ( dentroDeInterfaz( pila[ i ] ) ) { continue; }
			var el = pila[ i ].closest( '[data-retoque], [data-retoque-fondo]' );
			if ( el ) { return el; }
		}
		return null;
	}

	function nombreCapa( el ) {
		return el.getAttribute( 'data-retoque-nombre-capa' ) || 'Fondo';
	}

	function todosLosEditables() {
		return Array.prototype.slice.call( document.querySelectorAll( '[data-retoque]' ) );
	}

	function leerSesion() {
		try { return window.sessionStorage.getItem( CLAVE_SESION ) || ''; } catch ( e ) { return ''; }
	}

	function escribirSesion( valor ) {
		try { window.sessionStorage.setItem( CLAVE_SESION, valor || '' ); } catch ( e ) {}
	}

	function cantidadCambios() {
		return Object.keys( estado.cambios ).length;
	}

	function textoDe( el ) {
		// innerText respeta los saltos de línea visibles.
		return ( el.innerText || el.textContent || '' ).replace( / /g, ' ' ).replace( /\n{3,}/g, '\n\n' ).trim();
	}

	function aviso( mensaje, tipo ) {
		var caja = crear( 'div', 'retoque-aviso retoque-aviso--' + ( tipo || 'ok' ), mensaje );
		caja.setAttribute( 'role', 'status' );
		document.body.appendChild( caja );
		window.setTimeout( function () { caja.classList.add( 'es-visible' ); }, 10 );
		window.setTimeout( function () {
			caja.classList.remove( 'es-visible' );
			window.setTimeout( function () { caja.remove(); }, 300 );
		}, tipo === 'error' ? 6500 : 3000 );
	}

	function escaparCss( valor ) {
		return window.CSS && window.CSS.escape ? window.CSS.escape( valor ) : String( valor ).replace( /[^a-zA-Z0-9_\-]/g, '\\$&' );
	}

	/** Pide algo al servidor y devuelve el cuerpo JSON, o lanza un error con el mensaje del servidor. */
	function pedir( url, opciones ) {
		opciones.credentials = 'same-origin';
		opciones.headers = opciones.headers || {};
		if ( datos.nonce ) { opciones.headers[ 'X-WP-Nonce' ] = datos.nonce; }
		if ( datos.revision ) { opciones.headers[ 'X-Retoque-Revision' ] = datos.revision; }
		return window.fetch( url, opciones ).then( function ( respuesta ) {
			return respuesta.json().catch( function () { return {}; } ).then( function ( cuerpo ) {
				if ( ! respuesta.ok ) {
					var mensaje = cuerpo.message || 'El servidor respondió con un error (' + respuesta.status + ').';
					if ( /nonce|cookie/i.test( mensaje ) ) {
						mensaje = 'Tu sesión expiró. Recarga la página e inténtalo de nuevo.';
					}
					throw new Error( mensaje );
				}
				return cuerpo;
			} );
		} );
	}

	/* ------------------------------------------------------------------
	 * Registro de cambios
	 * ---------------------------------------------------------------- */

	function guardarOriginal( el ) {
		if ( esFondo( el ) ) {
			var idFondo = idCambio( el.getAttribute( 'data-retoque-fondo' ), paginaDe( el ), 'imagen' );
			if ( ! estado.originales[ idFondo ] ) {
				estado.originales[ idFondo ] = { fondo: el.style.getPropertyValue( '--retoque-imagen-fondo' ), conFondo: el.hasAttribute( 'data-retoque-con-fondo' ) };
			}
			return;
		}
		var clave = el.getAttribute( 'data-retoque' );
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		var id = idCambio( clave, paginaDe( el ), tipo );
		if ( estado.originales[ id ] ) { return; }

		if ( tipo === 'imagen' ) {
			estado.originales[ id ] = {
				src: el.getAttribute( 'src' ),
				srcset: el.getAttribute( 'srcset' ),
				sizes: el.getAttribute( 'sizes' ),
				alt: el.getAttribute( 'alt' )
			};
		} else if ( tipo === 'enlace' ) {
			estado.originales[ id ] = {
				href: el.getAttribute( 'href' ),
				url: el.getAttribute( 'data-retoque-url' ),
				texto: etiquetaDeEnlace( el ).textContent
			};
		} else if ( tipo === 'opcion' ) {
			estado.originales[ id ] = { valor: el.getAttribute( 'data-retoque-valor' ) };
		} else {
			estado.originales[ id ] = { html: el.innerHTML };
		}
	}

	function registrarCambio( clave, pagina, tipo, valor, restablecer ) {
		estado.cambios[ idCambio( clave, pagina, tipo ) ] = {
			clave: clave,
			tipo: tipo,
			valor: valor,
			pagina: parseInt( pagina, 10 ) || 0,
			restablecer: !! restablecer
		};
		if ( tipo !== 'lista' ) {
			elementosDe( clave, pagina ).concat( fondosDe( clave, pagina ) ).forEach( function ( el ) { el.classList.add( 'retoque-modificado' ); } );
		}
		actualizarBarra();
	}

	/* ------------------------------------------------------------------
	 * Barra flotante
	 * ---------------------------------------------------------------- */

	function construirInterfaz() {
		ui.barra = crear( 'div', 'retoque-barra' );
		ui.barra.setAttribute( 'role', 'toolbar' );
		ui.barra.setAttribute( 'aria-label', 'Edición en vivo' );

		ui.editar = boton( 'retoque-boton retoque-boton--principal', 'Editar página', function () { cambiarModo( 'editar' ); } );
		ui.comentar = boton( 'retoque-boton retoque-boton--suave', 'Dejar nota', function () { cambiarModo( 'comentar' ); } );
		ui.estado = crear( 'span', 'retoque-barra__estado' );
		ui.descartar = boton( 'retoque-boton retoque-boton--suave', 'Descartar', descartarTodo );
		ui.guardar = boton( 'retoque-boton retoque-boton--guardar', 'Guardar', guardar );
		ui.salir = boton( 'retoque-boton retoque-boton--icono', '✕', function () { cambiarModo( '' ); } );
		ui.verNotas = boton( 'retoque-boton retoque-boton--notas', 'Mis notas', function () { abrirCajon(); } );
		ui.verNotas.setAttribute( 'aria-haspopup', 'dialog' );
		ui.salir.title = 'Salir';
		ui.salir.setAttribute( 'aria-label', 'Salir' );

		// Aviso de información que falta (texto o imagen con 'falta' en el tema). Cada toque lleva al siguiente.
		ui.faltas = boton( 'retoque-boton retoque-boton--faltas', '', irAFalta );
		ui.faltas.title = 'Partes de esta página que todavía no tienen su información. Toca para ir a la siguiente.';

		ui.barra.appendChild( ui.editar );
		ui.barra.appendChild( ui.comentar );
		ui.barra.appendChild( ui.faltas );
		ui.barra.appendChild( ui.estado );
		ui.barra.appendChild( ui.verNotas );

		// Recordatorio (1.13): las notas sin enviar no le llegan al equipo como nuevas.
		ui.recordatorio = boton( 'retoque-boton retoque-boton--recordatorio', '', function () { abrirCajon(); } );
		ui.recordatorio.title = 'Tus notas quedan guardadas, pero el equipo las recibe como nuevas solo cuando las envías.';
		ui.barra.appendChild( ui.recordatorio );

		// Solo los desarrolladores ven los contenedores.
		if ( datos.desarrollador && document.querySelector( '[data-contenedor]' ) ) {
			ui.contenedores = boton( 'retoque-boton retoque-boton--suave', 'Contenedores', function () { verContenedores( ! estado.verContenedores ); } );
			ui.contenedores.title = 'Muestra el nombre de cada sección. Toca un nombre para copiar su selector CSS.';
			ui.contenedores.setAttribute( 'aria-pressed', 'false' );
			ui.barra.appendChild( ui.contenedores );
		}

		ui.barra.appendChild( ui.descartar );
		ui.barra.appendChild( ui.guardar );
		ui.barra.appendChild( ui.salir );
		document.body.appendChild( ui.barra );

		// Mini barra que aparece sobre el elemento seleccionado.
		ui.chip = crear( 'div', 'retoque-chip' );
		ui.chip.hidden = true;
		document.body.appendChild( ui.chip );

		actualizarBarra();
	}

	/* Información que falta */
	function faltasPendientes() {
		return Array.prototype.filter.call( document.querySelectorAll( '[data-retoque-falta]' ), function ( el ) {
			if ( el.closest( 'template' ) ) { return false; }
			if ( el.tagName === 'IMG' ) { return ( el.getAttribute( 'src' ) || '' ).indexOf( 'data:image/svg+xml' ) === 0; }
			return el.textContent.trim() === '' && ! el.querySelector( 'img' );
		} );
	}

	function irAFalta() {
		var lista = faltasPendientes();
		if ( ! lista.length ) { return; }
		estado.indiceFalta = ( ( estado.indiceFalta || 0 ) + 1 ) % lista.length;
		var el = lista[ estado.indiceFalta ];
		el.scrollIntoView( { behavior: 'smooth', block: 'center' } );
		el.classList.remove( 'retoque-falta-destello' );
		void el.offsetWidth;
		el.classList.add( 'retoque-falta-destello' );
	}

	function actualizarFaltas() {
		if ( ! ui.faltas ) { return; }
		var n = faltasPendientes().length;
		ui.faltas.hidden = n === 0 || estado.modo === 'comentar';
		ui.faltas.innerHTML = 'Falta' + ( n === 1 ? '' : 'n' ) + ' ' + n + '<span class="retoque-solo-ancho"> dato' + ( n === 1 ? '' : 's' ) + '</span>';
		ui.faltas.setAttribute( 'aria-label', 'Falta' + ( n === 1 ? ' 1 dato' : 'n ' + n + ' datos' ) + ' en esta página' );
	}

	function actualizarBarra() {
		actualizarFaltas();
		var n = cantidadCambios();
		var editando = estado.modo === 'editar';
		var comentando = estado.modo === 'comentar';

		ui.barra.classList.toggle( 'es-activa', !! estado.modo );
		ui.editar.hidden = !! estado.modo || !! datos.soloNotas;
		ui.comentar.hidden = !! estado.modo || ! datos.notasActivas;
		ui.comentar.textContent = estado.porEnviar ? 'Notas (' + estado.porEnviar + ' por enviar)' : 'Dejar nota';
		ui.verNotas.hidden = ! comentando;
		ui.verNotas.textContent = estado.porEnviar ? 'Mis notas (' + estado.porEnviar + ')' : 'Mis notas';
		ui.verNotas.classList.toggle( 'tiene-pendientes', estado.porEnviar > 0 );
		ui.recordatorio.hidden = ! estado.porEnviar || editando || !! datos.desarrollador;
		ui.recordatorio.textContent = 'Recuerda enviar ' + ( estado.porEnviar === 1 ? 'tu nota' : 'tus ' + estado.porEnviar + ' notas' ) + ' · Enviar';
		ui.estado.hidden = ! estado.modo;
		ui.salir.hidden = ! estado.modo;
		ui.descartar.hidden = ! editando || n === 0;
		ui.guardar.hidden = ! editando;
		ui.guardar.disabled = n === 0 || estado.guardando;
		ui.guardar.textContent = estado.guardando ? 'Guardando…' : ( n ? 'Guardar (' + n + ')' : 'Guardar' );
		if ( ui.contenedores ) { ui.contenedores.hidden = ! editando; }

		if ( comentando ) {
			ui.estado.textContent = 'Toca la parte de la página que quieres comentar';
		} else {
			ui.estado.textContent = n ? 'Hay cambios sin guardar' : 'Toca un texto, un botón o una imagen';
		}
	}

	/* ------------------------------------------------------------------
	 * Modos
	 * ---------------------------------------------------------------- */

	function cambiarModo( modo ) {
		if ( modo === 'comentar' && ! datos.notasActivas ) { modo = ''; }
		if ( modo === 'editar' && datos.soloNotas ) { modo = ''; }
		if ( estado.modo === 'editar' && modo !== 'editar' && cantidadCambios() > 0 ) {
			if ( ! window.confirm( 'Tienes cambios sin guardar. ¿Salir y descartarlos?' ) ) { return; }
			descartarTodo();
		}
		deseleccionar();
		cerrarPanel();
		cerrarCajon();
		estado.modo = modo;
		escribirSesion( modo );

		document.body.classList.toggle( 'retoque-activo', modo === 'editar' );
		document.body.classList.toggle( 'retoque-comentando', modo === 'comentar' );

		if ( modo === 'editar' ) {
			todosLosEditables().forEach( function ( el ) {
				el.setAttribute( 'tabindex', el.getAttribute( 'tabindex' ) || '0' );
			} );
			decorarListas();
		} else {
			quitarControlesListas();
			verContenedores( false );
		}
		pintarPines();
		actualizarBarra();
	}

	/* ------------------------------------------------------------------
	 * Contenedores (solo desarrolladores)
	 * ---------------------------------------------------------------- */

	function verContenedores( encender ) {
		if ( ! ui.contenedores ) { return; }
		estado.verContenedores = encender;
		document.body.classList.toggle( 'retoque-ver-contenedores', encender );
		ui.contenedores.setAttribute( 'aria-pressed', encender ? 'true' : 'false' );
		ui.contenedores.classList.toggle( 'es-presionado', encender );
		pintarEtiquetasContenedores();
	}

	function pintarEtiquetasContenedores() {
		Array.prototype.forEach.call( document.querySelectorAll( '.retoque-etiqueta-contenedor' ), function ( el ) { el.remove(); } );
		if ( ! estado.verContenedores || estado.modo !== 'editar' ) { return; }

		var ocupados = {};
		Array.prototype.forEach.call( document.querySelectorAll( '[data-contenedor]' ), function ( zona ) {
			var r = zona.getBoundingClientRect();
			var estilo = window.getComputedStyle( zona );
			if ( ! r.width || ! r.height || estilo.visibility === 'hidden' || estilo.opacity === '0' ) { return; }

			// Un contenedor fijo (botón flotante) lleva la etiqueta fija junto a él.
			var fijo = estilo.position === 'fixed';
			var nombre = zona.getAttribute( 'data-contenedor' );
			var arriba = Math.round( r.top + ( fijo ? 0 : window.scrollY ) );
			var izquierda = Math.round( r.left + ( fijo ? 0 : window.scrollX ) );
			var llave = arriba + ':' + izquierda;
			while ( ocupados[ llave ] ) { arriba += 26; llave = arriba + ':' + izquierda; }
			ocupados[ llave ] = true;

			var etiqueta = boton( 'retoque-etiqueta-contenedor', nombre, function () { copiarSelector( nombre ); } );
			etiqueta.title = 'Copiar selector CSS';
			if ( fijo ) { etiqueta.classList.add( 'es-fija' ); }
			etiqueta.style.top = arriba + 'px';
			document.body.appendChild( etiqueta );
			var maximo = ( fijo ? 0 : window.scrollX ) + document.documentElement.clientWidth - etiqueta.offsetWidth;
			etiqueta.style.left = Math.max( 0, Math.min( izquierda, maximo ) ) + 'px';
		} );
	}

	function copiarSelector( nombre ) {
		var selector = '[data-contenedor="' + nombre + '"]';
		var listo = function () { aviso( 'Copiado: ' + selector ); };
		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( selector ).then( listo, function () { aviso( 'Contenedor: ' + selector ); } );
		} else {
			aviso( 'Contenedor: ' + selector );
		}
	}

	/* ------------------------------------------------------------------
	 * Selección
	 * ---------------------------------------------------------------- */

	function seleccionar( el ) {
		if ( estado.seleccionado === el ) { return; }
		deseleccionar();
		estado.seleccionado = el;
		guardarOriginal( el );
		el.classList.add( 'retoque-seleccionado' );

		var tipo = esFondo( el ) ? 'fondo' : el.getAttribute( 'data-retoque-tipo' );
		if ( tipo === 'texto' || tipo === 'parrafo' || tipo === 'formato' ) {
			editarTexto( el );
		}
		mostrarChip( el );
	}

	function deseleccionar() {
		var el = estado.seleccionado;
		if ( ! el ) { return; }
		el.classList.remove( 'retoque-seleccionado' );
		if ( el.isContentEditable ) {
			terminarTexto( el );
		}
		estado.seleccionado = null;
		ui.chip.hidden = true;
		cerrarPanel();
	}

	function mostrarChip( el ) {
		var tipo = esFondo( el ) ? 'fondo' : el.getAttribute( 'data-retoque-tipo' );
		var nombres = { texto: 'Texto', parrafo: 'Párrafo', formato: 'Texto', imagen: 'Imagen', enlace: 'Botón', opcion: 'Categoría', fondo: nombreCapa( el ) };
		ui.chip.innerHTML = '';
		ui.chip.appendChild( crear( 'span', 'retoque-chip__tipo', nombres[ tipo ] || 'Campo' ) );

		if ( tipo === 'fondo' ) {
			ui.chip.appendChild( boton( 'retoque-chip__boton', 'Cambiar fondo', function () { elegirFondo( el ); } ) );
		}

		if ( tipo === 'formato' ) {
			agregarBotonesFormato( el );
		}
		if ( tipo === 'imagen' ) {
			ui.chip.appendChild( boton( 'retoque-chip__boton', 'Cambiar imagen', function () { elegirImagen( el ); } ) );
		}
		if ( tipo === 'enlace' ) {
			ui.chip.appendChild( boton( 'retoque-chip__boton', 'Editar botón', function () { abrirPanelEnlace( el ); } ) );
		}
		if ( tipo === 'opcion' ) {
			ui.chip.appendChild( boton( 'retoque-chip__boton', '▾ Elegir', function () { abrirPanelOpcion( el ); } ) );
		}

		var original = boton( 'retoque-chip__boton', '↺ Original', function () { restablecer( el ); } );
		original.title = 'Volver al contenido original del diseño';
		ui.chip.appendChild( original );

		// Que los botones del chip no le quiten el foco al texto.
		Array.prototype.forEach.call( ui.chip.querySelectorAll( 'button' ), function ( b ) {
			b.addEventListener( 'mousedown', function ( e ) { e.preventDefault(); } );
		} );

		ui.chip.hidden = false;
		posicionarChip( el );
	}

	function posicionarChip( el ) {
		if ( ui.chip.hidden || ! el ) { return; }
		var r = el.getBoundingClientRect();
		var arriba = r.top + window.scrollY - ui.chip.offsetHeight - 8;
		if ( r.top < ui.chip.offsetHeight + 50 ) {
			arriba = r.bottom + window.scrollY + 8;
		}
		var izquierda = Math.max( 8, Math.min( r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - ui.chip.offsetWidth - 8 ) );
		ui.chip.style.top = arriba + 'px';
		ui.chip.style.left = izquierda + 'px';
	}

	/* ------------------------------------------------------------------
	 * Texto
	 * ---------------------------------------------------------------- */

	function editarTexto( el ) {
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		if ( tipo === 'formato' ) {
			el.contentEditable = 'true';
			try { document.execCommand( 'defaultParagraphSeparator', false, 'p' ); } catch ( e ) {}
		} else {
			try { el.contentEditable = 'plaintext-only'; } catch ( e ) { el.contentEditable = 'true'; }
			if ( el.contentEditable !== 'plaintext-only' ) { el.contentEditable = 'true'; }
		}
		el.spellcheck = true;
		el.focus( { preventScroll: true } );
	}

	function valorDeTexto( el ) {
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		if ( tipo === 'formato' ) {
			return textoDe( el ) === '' ? '' : el.innerHTML.trim();
		}
		var valor = textoDe( el );
		return tipo === 'texto' ? valor.replace( /\s*\n\s*/g, ' ' ) : valor;
	}

	function terminarTexto( el ) {
		el.removeAttribute( 'contenteditable' );
		var clave = el.getAttribute( 'data-retoque' );
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		var pagina = paginaDe( el );
		var original = estado.originales[ idCambio( clave, pagina, tipo ) ];
		var valor = valorDeTexto( el );

		if ( valor === '' ) {
			if ( el.hasAttribute( 'data-retoque-ayuda' ) ) {
				// Campo que puede quedar vacío: vuelve a su valor por defecto.
				el.innerHTML = '';
				registrarCambio( clave, pagina, tipo, null, true );
				return;
			}
			el.innerHTML = original ? original.html : '';
			aviso( 'El texto no puede quedar vacío. Usa "Original" para volver al texto del diseño.', 'error' );
			return;
		}

		var cambio = estado.cambios[ idCambio( clave, pagina, tipo ) ];
		if ( original && el.innerHTML === original.html && ! cambio ) { return; }

		pintarTexto( clave, pagina, tipo, valor, el );
		registrarCambio( clave, pagina, tipo, valor, false );
	}

	function pintarTexto( clave, pagina, tipo, valor, menos ) {
		elementosDe( clave, pagina ).forEach( function ( otro ) {
			if ( otro === menos ) { return; }
			if ( tipo === 'formato' ) {
				otro.innerHTML = valor;
			} else if ( tipo === 'parrafo' ) {
				otro.innerHTML = '';
				valor.split( '\n' ).forEach( function ( linea, i ) {
					if ( i > 0 ) { otro.appendChild( document.createElement( 'br' ) ); }
					otro.appendChild( document.createTextNode( linea ) );
				} );
			} else {
				otro.textContent = valor;
			}
		} );
	}

	/** Mientras se escribe, el cambio queda registrado y Guardar se habilita. */
	function alEscribir( e ) {
		var el = e.target.closest && e.target.closest( '[data-retoque]' );
		if ( ! el || el !== estado.seleccionado || ! el.isContentEditable ) { return; }
		var valor = valorDeTexto( el );
		if ( valor === '' ) { return; }
		var clave = el.getAttribute( 'data-retoque' );
		var pagina = paginaDe( el );
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		pintarTexto( clave, pagina, tipo, valor, el );
		registrarCambio( clave, pagina, tipo, valor, false );
	}

	/* ------------------------------------------------------------------
	 * Texto con formato: negrita, cursiva, enlace, lista
	 * ---------------------------------------------------------------- */

	function agregarBotonesFormato( el ) {
		var comando = function ( nombre ) {
			return function () {
				el.focus( { preventScroll: true } );
				document.execCommand( nombre, false, null );
				alEscribir( { target: el } );
			};
		};
		var negrita = boton( 'retoque-chip__boton retoque-chip__boton--negrita', 'B', comando( 'bold' ) );
		negrita.title = 'Negrita';
		var cursiva = boton( 'retoque-chip__boton retoque-chip__boton--cursiva', 'I', comando( 'italic' ) );
		cursiva.title = 'Cursiva';
		var lista = boton( 'retoque-chip__boton', '• Lista', comando( 'insertUnorderedList' ) );
		var enlace = boton( 'retoque-chip__boton', 'Enlace', function () { pedirEnlaceFormato( el ); } );
		enlace.title = 'Enlace';
		var limpiar = boton( 'retoque-chip__boton', 'Tx', function () {
			el.focus( { preventScroll: true } );
			document.execCommand( 'removeFormat', false, null );
			document.execCommand( 'unlink', false, null );
			alEscribir( { target: el } );
		} );
		limpiar.title = 'Quitar formato';
		[ negrita, cursiva, enlace, lista, limpiar ].forEach( function ( b ) { ui.chip.appendChild( b ); } );
	}

	function pedirEnlaceFormato( el ) {
		var seleccion = window.getSelection();
		if ( ! seleccion || seleccion.isCollapsed ) {
			aviso( 'Primero selecciona las palabras que quieres convertir en enlace.', 'error' );
			return;
		}
		var rango = seleccion.getRangeAt( 0 ).cloneRange();
		ui.chip.innerHTML = '';
		var campo = crear( 'input', 'retoque-chip__campo' );
		campo.type = 'text';
		campo.inputMode = 'url';
		campo.placeholder = 'https://… · tel:… · mailto:…';
		var aplicar = boton( 'retoque-chip__boton', 'Aplicar', function () {
			var url = normalizarUrl( campo.value.trim() );
			el.focus( { preventScroll: true } );
			var sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( rango );
			if ( url ) { document.execCommand( 'createLink', false, url ); }
			alEscribir( { target: el } );
			mostrarChip( el );
		} );
		ui.chip.appendChild( campo );
		ui.chip.appendChild( aplicar );
		ui.chip.appendChild( boton( 'retoque-chip__boton', 'Cancelar', function () { mostrarChip( el ); } ) );
		campo.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Enter' ) { e.preventDefault(); aplicar.click(); }
			if ( e.key === 'Escape' ) { e.preventDefault(); mostrarChip( el ); }
		} );
		campo.focus();
	}

	function normalizarUrl( url ) {
		if ( url && ! /^(https?:|mailto:|tel:|#|\/)/i.test( url ) ) {
			url = 'https://' + url;
		}
		return url;
	}

	/* ------------------------------------------------------------------
	 * Imagen
	 * ---------------------------------------------------------------- */

	function elegirFondo( el ) {
		if ( ! window.wp || ! window.wp.media ) {
			aviso( 'No se pudo abrir la biblioteca de medios. Recarga la página.', 'error' );
			return;
		}
		guardarOriginal( el );
		var marco = window.wp.media( {
			title: 'Elegir imagen de fondo',
			button: { text: 'Usar de fondo' },
			library: { type: 'image' },
			multiple: false
		} );
		marco.on( 'select', function () {
			var adjunto = marco.state().get( 'selection' ).first().toJSON();
			var tamanos = adjunto.sizes || {};
			var url = ( tamanos.large && tamanos.large.url ) || ( tamanos.full && tamanos.full.url ) || adjunto.url;
			var clave = el.getAttribute( 'data-retoque-fondo' );
			var pagina = paginaDe( el );
			pintarFondo( clave, pagina, url );
			registrarCambio( clave, pagina, 'imagen', { id: adjunto.id, alt: '' }, false );
			window.setTimeout( function () { posicionarChip( el ); }, 300 );
		} );
		marco.open();
	}

	function pintarFondo( clave, pagina, url ) {
		fondosDe( clave, pagina ).forEach( function ( f ) {
			if ( url ) {
				f.style.setProperty( '--retoque-imagen-fondo', 'url("' + url + '")' );
				f.setAttribute( 'data-retoque-con-fondo', '' );
			} else {
				f.style.removeProperty( '--retoque-imagen-fondo' );
				f.removeAttribute( 'data-retoque-con-fondo' );
			}
		} );
	}

	function elegirImagen( el ) {
		if ( ! window.wp || ! window.wp.media ) {
			aviso( 'No se pudo abrir la biblioteca de medios. Recarga la página.', 'error' );
			return;
		}
		guardarOriginal( el );
		var marco = window.wp.media( {
			title: 'Elegir imagen',
			button: { text: 'Usar esta imagen' },
			library: { type: 'image' },
			multiple: false
		} );
		marco.on( 'select', function () {
			var adjunto = marco.state().get( 'selection' ).first().toJSON();
			var tamanos = adjunto.sizes || {};
			var url = ( tamanos.large && tamanos.large.url ) || ( tamanos.full && tamanos.full.url ) || adjunto.url;
			var clave = el.getAttribute( 'data-retoque' );
			var pagina = paginaDe( el );
			var alt = adjunto.alt || el.getAttribute( 'alt' ) || '';

			elementosDe( clave, pagina ).forEach( function ( img ) {
				img.removeAttribute( 'srcset' );
				img.removeAttribute( 'sizes' );
				img.setAttribute( 'src', url );
				img.setAttribute( 'alt', alt );
			} );
			// Imagen de celular de un banner (v1.7): también cambia la que usa <picture>.
			Array.prototype.forEach.call( document.querySelectorAll( '[data-retoque-fuente-celular="' + clave + '"]' ), function ( fuente ) { fuente.setAttribute( 'srcset', url ); } );
			if ( el.hasAttribute( 'data-retoque-celular-de' ) && ! document.querySelector( '[data-retoque-fuente-celular="' + clave + '"]' ) ) {
				// Ojo: no llamar «marco» a esta variable; taparía a la ventana de medios de arriba (error de 1.7 a 1.13).
				var cajaCelular = el.closest( '.retoque-celular' );
				var picture = cajaCelular && cajaCelular.previousElementSibling;
				if ( picture && picture.tagName === 'PICTURE' ) {
					var fuente = document.createElement( 'source' );
					fuente.media = '(max-width: 767px)'; fuente.srcset = url; fuente.setAttribute( 'data-retoque-fuente-celular', clave );
					picture.insertBefore( fuente, picture.firstChild );
				}
			}
			registrarCambio( clave, pagina, 'imagen', { id: adjunto.id, alt: alt }, false );
			window.setTimeout( function () { posicionarChip( el ); }, 300 );
		} );
		marco.open();
	}

	/* ------------------------------------------------------------------
	 * Paneles (botón, categoría, nota)
	 * ---------------------------------------------------------------- */

	function abrirPanel( titulo, cerca ) {
		cerrarPanel();
		var panel = crear( 'div', 'retoque-panel' );
		panel.setAttribute( 'role', 'dialog' );
		panel.setAttribute( 'aria-label', titulo );
		document.body.appendChild( panel );
		ui.panel = panel;

		var ancho = Math.min( 360, document.documentElement.clientWidth - 16 );
		panel.style.width = ancho + 'px';
		var arriba;
		var izquierda;
		if ( cerca.pageY !== undefined ) {
			arriba = cerca.pageY + 14;
			izquierda = cerca.pageX - ancho / 2;
		} else {
			var r = cerca.getBoundingClientRect();
			arriba = r.bottom + window.scrollY + 10;
			izquierda = r.left + window.scrollX;
		}
		panel.style.top = arriba + 'px';
		panel.style.left = Math.max( 8, Math.min( izquierda, window.scrollX + document.documentElement.clientWidth - ancho - 8 ) ) + 'px';
		panel.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Escape' ) { cerrarPanel(); }
		} );
		return panel;
	}

	/* Dato que se cambia en otro lugar (v1.7): aviso con botón para abrirlo */
	function mostrarExterno( el, e ) {
		var donde = el.getAttribute( 'data-retoque-externo-donde' );
		var url = el.getAttribute( 'data-retoque-externo' );
		var panel = abrirPanel( 'Dónde se cambia', e && e.pageY !== undefined ? e : el );
		var falta = el.getAttribute( 'data-retoque-falta' );
		panel.appendChild( crear( 'p', 'retoque-panel__titulo', falta ? 'Falta: ' + falta : 'Esto no se cambia aquí' ) );
		panel.appendChild( crear( 'p', 'retoque-panel__ayuda', 'Se cambia en ' + donde + '. Lo que guardes ahí aparece solo en la página.' ) );
		var acciones = crear( 'div', 'retoque-panel__acciones' );
		acciones.appendChild( boton( 'retoque-boton retoque-boton--suave', 'Cerrar', cerrarPanel ) );
		if ( url ) {
			var abrir = crear( 'a', 'retoque-boton retoque-boton--guardar', 'Abrir ' + donde.split( '›' ).pop().trim() );
			abrir.href = url; abrir.target = '_blank'; abrir.rel = 'noopener';
			acciones.appendChild( abrir );
		}
		panel.appendChild( acciones );
		var foco = panel.querySelector( 'a, button' );
		if ( foco ) { foco.focus(); }
	}

	function cerrarPanel() {
		if ( ui.panel ) {
			ui.panel.remove();
			ui.panel = null;
		}
		var marca = document.querySelector( '.retoque-pin--borrador' );
		if ( marca ) { marca.remove(); }
	}

	function campoPanel( panel, etiqueta, tipo, valor, id ) {
		var label = crear( 'label', 'retoque-panel__etiqueta', etiqueta );
		var campo = crear( tipo === 'textarea' ? 'textarea' : ( tipo === 'select' ? 'select' : 'input' ), 'retoque-panel__campo' );
		campo.id = id;
		label.htmlFor = id;
		if ( tipo !== 'textarea' && tipo !== 'select' ) { campo.type = tipo; }
		if ( valor !== undefined && tipo !== 'select' ) { campo.value = valor; }
		panel.appendChild( label );
		panel.appendChild( campo );
		return campo;
	}

	function accionesPanel( panel, textoAceptar, alAceptar ) {
		var acciones = crear( 'div', 'retoque-panel__acciones' );
		var cancelar = boton( 'retoque-boton retoque-boton--suave', 'Cancelar', cerrarPanel );
		var aceptar = boton( 'retoque-boton retoque-boton--guardar', textoAceptar, alAceptar );
		acciones.appendChild( cancelar );
		acciones.appendChild( aceptar );
		panel.appendChild( acciones );
		return aceptar;
	}

	/* Botón o enlace */

	function etiquetaDeEnlace( el ) {
		return el.querySelector( '.retoque-enlace-texto' ) || el;
	}

	function abrirPanelEnlace( el ) {
		guardarOriginal( el );
		var panel = abrirPanel( 'Editar botón', el );
		var campoTexto = campoPanel( panel, 'Texto del botón', 'text', etiquetaDeEnlace( el ).textContent.trim(), 'retoque-enlace-texto' );
		var campoUrl = campoPanel( panel, 'Lleva a…', 'text', el.getAttribute( 'data-retoque-url' ) || el.getAttribute( 'href' ) || '', 'retoque-enlace-url' );
		campoUrl.inputMode = 'url';
		panel.appendChild( crear( 'p', 'retoque-panel__ayuda',
			'Ejemplos: https://wa.me/56912345678 · tel:+56912345678 · mailto:correo@dominio.cl · #contacto' ) );
		var aplicar = accionesPanel( panel, 'Aplicar', function () {
			var texto = campoTexto.value.trim();
			if ( ! texto ) {
				aviso( 'El botón necesita un texto.', 'error' );
				return;
			}
			var url = normalizarUrl( campoUrl.value.trim() );
			var clave = el.getAttribute( 'data-retoque' );
			var pagina = paginaDe( el );
			pintarEnlace( clave, pagina, texto, url );
			registrarCambio( clave, pagina, 'enlace', { texto: texto, url: url }, false );
			cerrarPanel();
		} );
		panel.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Enter' ) { e.preventDefault(); aplicar.click(); }
		} );
		campoTexto.focus();
	}

	function pintarEnlace( clave, pagina, texto, url ) {
		elementosDe( clave, pagina ).forEach( function ( a ) {
			etiquetaDeEnlace( a ).textContent = texto;
			a.setAttribute( 'href', url || '#' );
			a.setAttribute( 'data-retoque-url', url );
		} );
	}

	/* Categoría (opción) */

	function opcionesDe( el ) {
		try { return JSON.parse( el.getAttribute( 'data-retoque-opciones' ) || '{}' ); } catch ( e ) { return {}; }
	}

	function abrirPanelOpcion( el ) {
		guardarOriginal( el );
		var opciones = opcionesDe( el );
		var panel = abrirPanel( 'Elegir categoría', el );
		var lista = campoPanel( panel, 'Categoría', 'select', undefined, 'retoque-opcion' );
		Object.keys( opciones ).forEach( function ( valor ) {
			var op = crear( 'option', '', opciones[ valor ] );
			op.value = valor;
			op.selected = valor === el.getAttribute( 'data-retoque-valor' );
			lista.appendChild( op );
		} );
		accionesPanel( panel, 'Aplicar', function () {
			var clave = el.getAttribute( 'data-retoque' );
			var pagina = paginaDe( el );
			pintarOpcion( clave, pagina, lista.value );
			registrarCambio( clave, pagina, 'opcion', lista.value, false );
			cerrarPanel();
		} );
		lista.focus();
	}

	function pintarOpcion( clave, pagina, valor ) {
		elementosDe( clave, pagina ).forEach( function ( el ) {
			var opciones = opcionesDe( el );
			var anterior = el.getAttribute( 'data-retoque-valor' );
			var prefijo = el.getAttribute( 'data-retoque-clase-valor' );
			var reflejar = el.getAttribute( 'data-retoque-reflejar' );
			el.textContent = opciones[ valor ] || valor;
			el.setAttribute( 'data-retoque-valor', valor );
			if ( prefijo ) {
				el.classList.remove( prefijo + anterior );
				el.classList.add( prefijo + valor );
			}
			if ( reflejar ) {
				var duenno = el.closest( '[data-retoque-item]' ) || el.parentElement;
				if ( duenno ) { duenno.setAttribute( reflejar, valor ); }
			}
		} );
	}

	/* ------------------------------------------------------------------
	 * Listas: agregar, quitar y ordenar
	 * ---------------------------------------------------------------- */

	function idLista( lista ) {
		return idCambio( lista.getAttribute( 'data-retoque-lista' ), paginaDe( lista ), 'lista' );
	}

	function elementosDeLista( lista ) {
		return Array.prototype.filter.call( lista.children, function ( hijo ) { return hijo.hasAttribute( 'data-retoque-item' ); } );
	}

	function guardarOrdenOriginal( lista ) {
		var id = idLista( lista );
		if ( ! estado.listas[ id ] ) {
			estado.listas[ id ] = { lista: lista, nodos: elementosDeLista( lista ) };
		}
	}

	function registrarLista( lista ) {
		var ids = elementosDeLista( lista ).map( function ( item ) { return item.getAttribute( 'data-retoque-item' ); } );
		registrarCambio( lista.getAttribute( 'data-retoque-lista' ), paginaDe( lista ), 'lista', ids, false );
		window.setTimeout( pintarPines, 50 );
	}

	function decorarListas() {
		if ( ! datos.listas ) { return; }
		Array.prototype.forEach.call( document.querySelectorAll( '[data-retoque-lista]' ), function ( lista ) {
			elementosDeLista( lista ).forEach( decorarElemento );
			if ( ! lista._retoqueAgregar ) {
				var nombre = lista.getAttribute( 'data-retoque-nombre' ) || 'elemento';
				var agregar = boton( 'retoque-agregar', '+ Agregar ' + nombre, function () { agregarElemento( lista ); } );
				lista.insertAdjacentElement( 'afterend', agregar );
				lista._retoqueAgregar = agregar;
			}
		} );
	}

	function decorarElemento( item ) {
		if ( item.querySelector( ':scope > .retoque-controles-item' ) ) { return; }
		var caja = crear( 'div', 'retoque-controles-item' );
		var lista = item.parentElement;
		var subir = boton( 'retoque-control', '↑', function () {
			var anterior = item.previousElementSibling;
			if ( anterior && anterior.hasAttribute( 'data-retoque-item' ) ) {
				guardarOrdenOriginal( lista );
				lista.insertBefore( item, anterior );
				registrarLista( lista );
			}
		} );
		subir.title = 'Mover antes';
		var bajar = boton( 'retoque-control', '↓', function () {
			var siguiente = item.nextElementSibling;
			if ( siguiente && siguiente.hasAttribute( 'data-retoque-item' ) ) {
				guardarOrdenOriginal( lista );
				lista.insertBefore( siguiente, item );
				registrarLista( lista );
			}
		} );
		bajar.title = 'Mover después';
		var quitar = boton( 'retoque-control retoque-control--quitar', '✕', function () {
			guardarOrdenOriginal( lista );
			if ( estado.seleccionado && item.contains( estado.seleccionado ) ) { deseleccionar(); }
			item.remove();
			registrarLista( lista );
			aviso( 'Quitado. Si fue un error, toca "Descartar" antes de guardar.' );
		} );
		quitar.title = 'Quitar';
		caja.appendChild( subir );
		caja.appendChild( bajar );
		caja.appendChild( quitar );
		item.appendChild( caja );
	}

	function agregarElemento( lista ) {
		var clave = lista.getAttribute( 'data-retoque-lista' );
		var molde = document.querySelector( 'template[data-retoque-plantilla="' + clave + '"]' );
		if ( ! molde ) { return; }
		guardarOrdenOriginal( lista );
		var nuevoId = 'n' + Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 );
		var envoltura = document.createElement( lista.tagName );
		envoltura.innerHTML = molde.innerHTML.split( '__nuevo__' ).join( nuevoId );
		var item = envoltura.firstElementChild;
		if ( ! item ) { return; }
		lista.appendChild( item );
		Array.prototype.forEach.call( item.querySelectorAll( '[data-retoque]' ), function ( el ) {
			el.setAttribute( 'tabindex', '0' );
		} );
		decorarElemento( item );
		registrarLista( lista );
		item.scrollIntoView( { behavior: 'smooth', block: 'center' } );
		aviso( 'Agregado. Toca sus textos e imagen para completarlo.' );
	}

	function quitarControlesListas() {
		Array.prototype.forEach.call( document.querySelectorAll( '.retoque-controles-item' ), function ( el ) { el.remove(); } );
		Array.prototype.forEach.call( document.querySelectorAll( '[data-retoque-lista]' ), function ( lista ) {
			if ( lista._retoqueAgregar ) {
				lista._retoqueAgregar.remove();
				lista._retoqueAgregar = null;
			}
		} );
	}

	/* ------------------------------------------------------------------
	 * Restablecer y descartar
	 * ---------------------------------------------------------------- */

	function restablecer( el ) {
		if ( esFondo( el ) ) {
			guardarOriginal( el );
			pintarFondo( el.getAttribute( 'data-retoque-fondo' ), paginaDe( el ), el.getAttribute( 'data-retoque-defecto' ) || '' );
			registrarCambio( el.getAttribute( 'data-retoque-fondo' ), paginaDe( el ), 'imagen', null, true );
			deseleccionar();
			return;
		}
		var clave = el.getAttribute( 'data-retoque' );
		var tipo = el.getAttribute( 'data-retoque-tipo' );
		var pagina = paginaDe( el );
		var defecto = el.getAttribute( 'data-retoque-defecto' ) || '';
		guardarOriginal( el );

		if ( el.isContentEditable ) { el.removeAttribute( 'contenteditable' ); }

		if ( tipo === 'imagen' ) {
			elementosDe( clave, pagina ).forEach( function ( img ) {
				img.removeAttribute( 'srcset' );
				img.removeAttribute( 'sizes' );
				img.setAttribute( 'src', defecto );
			} );
		} else if ( tipo === 'enlace' ) {
			pintarEnlace( clave, pagina, defecto, el.getAttribute( 'data-retoque-defecto-url' ) || '' );
		} else if ( tipo === 'opcion' ) {
			pintarOpcion( clave, pagina, defecto );
		} else {
			pintarTexto( clave, pagina, tipo, defecto, null );
		}
		registrarCambio( clave, pagina, tipo, null, true );
		estado.seleccionado = null;
		el.classList.remove( 'retoque-seleccionado' );
		ui.chip.hidden = true;
		cerrarPanel();
	}

	function descartarTodo() {
		deseleccionar();

		// Primero las listas: vuelven los elementos quitados y se van los agregados.
		Object.keys( estado.listas ).forEach( function ( id ) {
			var registro = estado.listas[ id ];
			elementosDeLista( registro.lista ).forEach( function ( item ) { item.remove(); } );
			registro.nodos.forEach( function ( item ) { registro.lista.appendChild( item ); } );
		} );

		Object.keys( estado.cambios ).forEach( function ( id ) {
			var cambio = estado.cambios[ id ];
			var original = estado.originales[ id ];
			if ( ! original || cambio.tipo === 'lista' ) { return; }
			if ( original.fondo !== undefined ) {
				fondosDe( cambio.clave, cambio.pagina ).forEach( function ( f ) {
					f.classList.remove( 'retoque-modificado' );
					if ( original.fondo ) { f.style.setProperty( '--retoque-imagen-fondo', original.fondo ); } else { f.style.removeProperty( '--retoque-imagen-fondo' ); }
					if ( original.conFondo ) { f.setAttribute( 'data-retoque-con-fondo', '' ); } else { f.removeAttribute( 'data-retoque-con-fondo' ); }
				} );
				return;
			}
			elementosDe( cambio.clave, cambio.pagina ).forEach( function ( el ) {
				el.classList.remove( 'retoque-modificado' );
				if ( cambio.tipo === 'imagen' ) {
					[ 'src', 'srcset', 'sizes', 'alt' ].forEach( function ( atributo ) {
						if ( original[ atributo ] === null ) {
							el.removeAttribute( atributo );
						} else {
							el.setAttribute( atributo, original[ atributo ] );
						}
					} );
				} else if ( cambio.tipo === 'enlace' ) {
					etiquetaDeEnlace( el ).textContent = original.texto;
					el.setAttribute( 'href', original.href );
					el.setAttribute( 'data-retoque-url', original.url || '' );
				} else if ( cambio.tipo === 'opcion' ) {
					pintarOpcion( cambio.clave, cambio.pagina, original.valor );
				} else {
					el.innerHTML = original.html;
				}
			} );
		} );
		estado.cambios = {};
		estado.originales = {};
		estado.listas = {};
		actualizarBarra();
		pintarPines();
	}

	/* ------------------------------------------------------------------
	 * Guardar
	 * ---------------------------------------------------------------- */

	function guardar() {
		deseleccionar();
		var lista = Object.keys( estado.cambios ).map( function ( id ) { return estado.cambios[ id ]; } );
		if ( ! lista.length || estado.guardando ) { return; }

		estado.guardando = true;
		actualizarBarra();

		pedir( datos.api, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { cambios: lista } )
		} )
			.then( function ( cuerpo ) {
				var fallidos = cuerpo.errores || [];
				Object.keys( estado.cambios ).forEach( function ( id ) {
					var cambio = estado.cambios[ id ];
					if ( fallidos.indexOf( cambio.clave ) === -1 ) {
						elementosDe( cambio.clave, cambio.pagina ).concat( fondosDe( cambio.clave, cambio.pagina ) ).forEach( function ( el ) { el.classList.remove( 'retoque-modificado' ); } );
						delete estado.cambios[ id ];
						delete estado.originales[ id ];
						delete estado.listas[ id ];
					}
				} );
				if ( fallidos.length ) {
					aviso( 'Se guardó casi todo, pero ' + fallidos.length + ' cambio(s) no se pudieron guardar.' + ( cuerpo.mensaje ? ' ' + cuerpo.mensaje : '' ), 'error' );
				} else {
					aviso( '✓ Cambios guardados. Ya están publicados.' );
				}
			} )
			.catch( function ( error ) {
				aviso( 'No se pudo guardar: ' + ( error && error.message ? error.message : 'revisa tu conexión.' ), 'error' );
			} )
			.then( function () {
				estado.guardando = false;
				actualizarBarra();
			} );
	}

	/* ------------------------------------------------------------------
	 * Notas
	 * ---------------------------------------------------------------- */

	/** Arma un selector para volver a encontrar el elemento tocado. */
	function rutaDe( el ) {
		var pasos = [];
		var actual = el;
		while ( actual && actual.nodeType === 1 && actual !== document.body ) {
			if ( actual.id && /^[a-zA-Z][\w\-]*$/.test( actual.id ) && actual.id.indexOf( 'media-' ) !== 0 ) {
				pasos.unshift( '#' + escaparCss( actual.id ) );
				return pasos.join( ' > ' );
			}
			if ( actual.hasAttribute( 'data-retoque' ) ) {
				var sel = '[data-retoque="' + actual.getAttribute( 'data-retoque' ) + '"]';
				if ( document.querySelectorAll( sel ).length === 1 ) {
					pasos.unshift( sel );
					return pasos.join( ' > ' );
				}
			}
			if ( actual.hasAttribute( 'data-contenedor' ) ) {
				var selc = '[data-contenedor="' + actual.getAttribute( 'data-contenedor' ) + '"]';
				if ( document.querySelectorAll( selc ).length === 1 ) {
					pasos.unshift( selc );
					return pasos.join( ' > ' );
				}
			}
			var padre = actual.parentElement;
			if ( ! padre ) { break; }
			var indice = Array.prototype.indexOf.call( padre.children, actual ) + 1;
			pasos.unshift( actual.tagName.toLowerCase() + ':nth-child(' + indice + ')' );
			actual = padre;
		}
		pasos.unshift( 'body' );
		return pasos.join( ' > ' );
	}

	function buscar( selector ) {
		if ( ! selector ) { return null; }
		try { return document.querySelector( selector ); } catch ( e ) { return null; }
	}

	/* Enlace en las notas: el cliente pega el link de su Instagram, de una agenda, etc. */

	var REDES = [
		{ patron: /instagram/, nombre: 'Instagram', base: 'https://instagram.com/', ejemplo: 'https://instagram.com/tu_cuenta' },
		{ patron: /facebook|fb\.com/, nombre: 'Facebook', base: 'https://facebook.com/', ejemplo: 'https://facebook.com/tu_pagina' },
		{ patron: /tiktok/, nombre: 'TikTok', base: 'https://tiktok.com/@', ejemplo: 'https://tiktok.com/@tu_cuenta' },
		{ patron: /youtube|youtu\.be/, nombre: 'YouTube', base: 'https://youtube.com/@', ejemplo: 'https://youtube.com/@tu_canal' },
		{ patron: /linkedin/, nombre: 'LinkedIn', base: 'https://linkedin.com/in/', ejemplo: 'https://linkedin.com/company/tu_empresa' },
		{ patron: /wa\.me|whatsapp/, nombre: 'WhatsApp', base: '', ejemplo: 'https://wa.me/569XXXXXXXX' },
		{ patron: /twitter|x\.com/, nombre: 'X (Twitter)', base: 'https://x.com/', ejemplo: 'https://x.com/tu_cuenta' },
		{ patron: /agenda|agendar|reserva|calendly|\bcita/, nombre: 'Agenda', base: '', ejemplo: 'https://… (el enlace de tu agenda)' }
	];

	// Qué es lo que tocó: una red social, un botón, un enlace o un ícono (o null si es texto o imagen).
	function queEsElemento( objetivo ) {
		var enlace = objetivo.closest( 'a, button, [data-retoque-tipo="enlace"]' );
		var base = enlace || objetivo;
		var pista = [
			enlace ? enlace.getAttribute( 'href' ) : '',
			base.getAttribute( 'aria-label' ),
			base.getAttribute( 'title' ),
			base.getAttribute( 'class' ),
			objetivo.getAttribute( 'class' ),
			( objetivo.closest( 'svg' ) || {} ).getAttribute ? objetivo.closest( 'svg' ).getAttribute( 'class' ) : '',
			textoDe( base ).slice( 0, 80 )
		].join( ' ' ).toLowerCase();
		for ( var i = 0; i < REDES.length; i++ ) {
			if ( REDES[ i ].patron.test( pista ) ) { return REDES[ i ]; }
		}
		if ( enlace ) {
			var esBoton = enlace.tagName === 'BUTTON' || /boton|button|btn/.test( enlace.getAttribute( 'class' ) || '' );
			return { nombre: esBoton ? 'Botón' : 'Enlace', base: '', ejemplo: 'https://…' };
		}
		if ( objetivo.closest( 'svg' ) || /icono|icon/.test( pista ) ) {
			return { nombre: 'Ícono', base: '', ejemplo: 'https://…' };
		}
		return null;
	}

	// Ordena lo que pegó: «@cuenta» en Instagram pasa a https://instagram.com/cuenta; sin https se agrega.
	// Devuelve '' si está vacío y null si no es un enlace válido.
	function normalizarEnlace( valor, elemento ) {
		valor = ( valor || '' ).trim();
		if ( ! valor ) { return ''; }
		if ( valor.charAt( 0 ) === '@' && elemento && elemento.base ) {
			valor = elemento.base + valor.slice( 1 );
		} else if ( ! /^(https?:|mailto:|tel:)/i.test( valor ) ) {
			if ( /^[^\s\/]+\.[a-z]{2,}/i.test( valor ) ) {
				valor = 'https://' + valor;
			} else if ( elemento && elemento.base && /^[\w.\-]+$/.test( valor ) ) {
				valor = elemento.base + valor;
			} else {
				return null;
			}
		}
		try {
			var url = new window.URL( valor );
			if ( /^https?:$/.test( url.protocol ) && url.hostname.indexOf( '.' ) === -1 ) { return null; }
			return url.href;
		} catch ( e ) {
			return null;
		}
	}

	function campoEnlace( panel, elemento, valor ) {
		var esRed = elemento && [ 'Botón', 'Enlace', 'Ícono', 'Agenda' ].indexOf( elemento.nombre ) === -1;
		var etiqueta = esRed ? 'Enlace de tu ' + elemento.nombre + ' (opcional)'
			: ( elemento ? '¿A dónde debe llevar? Pega el enlace (opcional)' : 'Enlace (opcional)' );
		var campo = campoPanel( panel, etiqueta, 'url', valor || '', 'retoque-nota-enlace' );
		campo.placeholder = elemento ? elemento.ejemplo : 'https://…';
		campo.inputMode = 'url';
		campo.autocomplete = 'url';
		campo.spellcheck = false;
		return campo;
	}

	function pintarEnlaceNota( caja, nota, clase ) {
		if ( ! nota.enlace ) { return; }
		var p = crear( 'p', clase );
		p.appendChild( document.createTextNode( nota.red ? nota.red + ': ' : 'Enlace: ' ) );
		var a = crear( 'a', '', nota.enlace );
		a.href = nota.enlace;
		a.target = '_blank';
		a.rel = 'noopener';
		p.appendChild( a );
		caja.appendChild( p );
	}

	function abrirPanelNota( objetivo, evento ) {
		cerrarPanel();
		var r = objetivo.getBoundingClientRect();
		var dx = r.width ? Math.max( 0, Math.min( 1, ( evento.clientX - r.left ) / r.width ) ) : 0;
		var dy = r.height ? Math.max( 0, Math.min( 1, ( evento.clientY - r.top ) / r.height ) ) : 0;
		var contenedor = objetivo.closest( '[data-contenedor]' );
		var tocado = textoDe( objetivo ).slice( 0, 140 ) || ( objetivo.getAttribute( 'alt' ) || '' ) || ( objetivo.tagName === 'IMG' ? 'Imagen' : '' );

		var borrador = crear( 'span', 'retoque-pin retoque-pin--borrador', '+' );
		borrador.style.top = evento.pageY + 'px';
		borrador.style.left = evento.pageX + 'px';

		var panel = abrirPanel( 'Nueva nota', evento );
		document.body.appendChild( borrador );
		panel.classList.add( 'retoque-panel--nota' );
		panel.appendChild( crear( 'p', 'retoque-panel__titulo', 'Nota para el equipo' ) );
		if ( tocado ) {
			panel.appendChild( crear( 'p', 'retoque-panel__contexto', '«' + tocado + ( tocado.length >= 140 ? '…' : '' ) + '»' ) );
		}
		var campoNombre = null;
		if ( datos.pedirNombre ) {
			var recordado = '';
			try { recordado = window.localStorage.getItem( 'retoque_nombre' ) || ''; } catch ( e ) {}
			campoNombre = campoPanel( panel, 'Tu nombre', 'text', recordado, 'retoque-nota-nombre' );
			campoNombre.autocomplete = 'name';
		}
		var texto = campoPanel( panel, '¿Qué quieres cambiar o agregar aquí?', 'textarea', '', 'retoque-nota-texto' );
		texto.rows = 4;
		texto.placeholder = 'Ej.: aquí quiero agregar el horario de verano';
		var elemento = queEsElemento( objetivo );
		var campoLink = campoEnlace( panel, elemento );
		var foto = campoPanel( panel, 'Foto o captura (opcional)', 'file', undefined, 'retoque-nota-foto' );
		foto.accept = 'image/*';

		var enviar = accionesPanel( panel, 'Enviar nota', function () {
			var contenido = texto.value.trim();
			var enlace = normalizarEnlace( campoLink.value, elemento );
			if ( enlace === null ) {
				aviso( 'Ese enlace no parece válido. Cópialo desde la barra de direcciones (empieza con https://).', 'error' );
				campoLink.focus();
				return;
			}
			if ( ! contenido && enlace ) {
				contenido = 'Poner este enlace' + ( elemento ? ' en «' + ( tocado || elemento.nombre ) + '»' : '' ) + '.';
			}
			if ( ! contenido ) {
				aviso( 'Escribe la nota antes de enviarla.', 'error' );
				texto.focus();
				return;
			}
			var nombre = campoNombre ? campoNombre.value.trim() : '';
			if ( campoNombre && ! nombre ) {
				aviso( 'Escribe tu nombre para que sepamos quién deja la nota.', 'error' );
				campoNombre.focus();
				return;
			}
			if ( campoNombre ) {
				try { window.localStorage.setItem( 'retoque_nombre', nombre ); } catch ( e ) {}
			}
			var archivo = foto.files && foto.files[ 0 ];
			if ( archivo && archivo.size > MAX_IMAGEN ) {
				aviso( 'La foto pesa más de 8 MB. Elige una más liviana o envía la nota sin foto.', 'error' );
				return;
			}
			var formulario = new window.FormData();
			formulario.append( 'texto', contenido );
			if ( nombre ) { formulario.append( 'nombre', nombre ); }
			formulario.append( 'url', window.location.href.split( '#' )[ 0 ] );
			formulario.append( 'pagina', String( datos.pagina || 0 ) );
			formulario.append( 'contenedor', contenedor ? contenedor.getAttribute( 'data-contenedor' ) : '' );
			formulario.append( 'ubicacion', rutaDe( objetivo ) );
			formulario.append( 'dx', dx.toFixed( 4 ) );
			formulario.append( 'dy', dy.toFixed( 4 ) );
			formulario.append( 'texto_elemento', tocado );
			formulario.append( 'ancho', String( window.innerWidth ) );
			formulario.append( 'alto', String( window.innerHeight ) );
			if ( enlace ) {
				formulario.append( 'enlace', enlace );
				if ( elemento ) { formulario.append( 'red', elemento.nombre ); }
			}
			if ( archivo ) { formulario.append( 'imagen', archivo ); }

			enviar.disabled = true;
			enviar.textContent = 'Guardando…';
			pedir( datos.apiNotas, { method: 'POST', body: formulario } )
				.then( function ( cuerpo ) {
					cerrarPanel();
					if ( cuerpo.nota ) { estado.notas.push( cuerpo.nota ); }
					if ( typeof cuerpo.por_enviar === 'number' ) { estado.porEnviar = cuerpo.por_enviar; }
					pintarPines();
					actualizarBarra();
					ui.verNotas.classList.remove( 'es-latido' );
					void ui.verNotas.offsetWidth;
					ui.verNotas.classList.add( 'es-latido' );
					if ( cuerpo.aviso_imagen ) {
						aviso( 'Nota guardada. ' + cuerpo.aviso_imagen, 'error' );
					} else {
						aviso( '✓ Nota guardada. Cuando termines, toca «Mis notas» › «Enviar notas»: si no las envías, el equipo no sabe que son nuevas.' );
					}
				} )
				.catch( function ( error ) {
					enviar.disabled = false;
					enviar.textContent = 'Guardar nota';
					aviso( 'No se pudo guardar: ' + error.message, 'error' );
				} );
		} );
		enviar.textContent = 'Guardar nota';
		( campoNombre && ! campoNombre.value ? campoNombre : texto ).focus();
		return enviar;
	}

	function pintarPines() {
		Array.prototype.forEach.call( document.querySelectorAll( '.retoque-pin:not(.retoque-pin--borrador)' ), function ( el ) { el.remove(); } );
		if ( estado.modo !== 'comentar' ) {
			Array.prototype.forEach.call( document.querySelectorAll( '.retoque-pin-detalle' ), function ( el ) { el.remove(); } );
			return;
		}

		var sueltas = 0;
		estado.notas.forEach( function ( nota, i ) {
			var el = buscar( nota.ubicacion ) || buscar( nota.contenedor ? '[data-contenedor="' + nota.contenedor + '"]' : '' );
			var arriba;
			var izquierda;
			if ( el && el.getBoundingClientRect().width ) {
				var r = el.getBoundingClientRect();
				arriba = r.top + window.scrollY + r.height * ( nota.dy || 0 );
				izquierda = r.left + window.scrollX + r.width * ( nota.dx || 0 );
			} else {
				// No se encontró el lugar (la página cambió): queda arriba a la izquierda.
				arriba = window.scrollY + 90 + sueltas * 44;
				izquierda = 24;
				sueltas++;
			}
			var maximo = document.documentElement.scrollWidth - 20;
			var pin = boton( 'retoque-pin' + ( nota.estado === 'borrador' ? ' retoque-pin--por-enviar' : '' ), String( i + 1 ), function () { abrirDetalleNota( nota, pin ); } );
			pin.title = nota.texto;
			pin.setAttribute( 'data-nota', String( nota.id ) );
			pin.style.top = arriba + 'px';
			pin.style.left = Math.max( 16, Math.min( izquierda, maximo ) ) + 'px';
			document.body.appendChild( pin );
		} );

		// Si hay un detalle abierto, sigue a su marcador (que se acaba de volver a crear).
		var abierto = document.querySelector( '.retoque-pin-detalle' );
		if ( abierto ) { posicionarDetalle( abierto ); }
	}

	function posicionarDetalle( caja ) {
		var pin = document.querySelector( '.retoque-pin[data-nota="' + caja.getAttribute( 'data-nota' ) + '"]' );
		if ( ! pin ) {
			caja.remove();
			return;
		}
		var r = pin.getBoundingClientRect();
		var ancho = Math.min( 320, document.documentElement.clientWidth - 16 );
		caja.style.width = ancho + 'px';
		caja.style.top = ( r.bottom + window.scrollY + 8 ) + 'px';
		caja.style.left = Math.max( 8, Math.min( r.left + window.scrollX - 20, window.scrollX + document.documentElement.clientWidth - ancho - 8 ) ) + 'px';
	}

	function abrirDetalleNota( nota, pin ) {
		Array.prototype.forEach.call( document.querySelectorAll( '.retoque-pin-detalle' ), function ( el ) { el.remove(); } );
		var caja = crear( 'div', 'retoque-pin-detalle' );
		caja.setAttribute( 'role', 'dialog' );
		caja.setAttribute( 'data-nota', String( nota.id ) );
		caja.appendChild( crear( 'span', 'retoque-estado-nota retoque-estado-nota--' + nota.estado, nota.estado_nombre || '' ) );
		caja.appendChild( crear( 'p', 'retoque-pin-detalle__texto', nota.texto ) );
		pintarEnlaceNota( caja, nota, 'retoque-pin-detalle__enlace' );
		caja.appendChild( crear( 'p', 'retoque-pin-detalle__meta', ( nota.autor ? nota.autor + ' · ' : '' ) + nota.fecha ) );
		if ( nota.imagen ) {
			var enlace = crear( 'a', 'retoque-pin-detalle__foto' );
			enlace.href = nota.imagen_full || nota.imagen;
			enlace.target = '_blank';
			enlace.rel = 'noopener';
			var img = crear( 'img' );
			img.src = nota.imagen;
			img.alt = 'Foto adjunta a la nota';
			enlace.appendChild( img );
			caja.appendChild( enlace );
		}
		if ( datos.desarrollador && nota.contenedor ) {
			caja.appendChild( crear( 'p', 'retoque-pin-detalle__meta', 'Contenedor: ' + nota.contenedor ) );
		}
		var acciones = crear( 'div', 'retoque-panel__acciones' );
		acciones.appendChild( boton( 'retoque-boton retoque-boton--suave', 'Cerrar', function () { caja.remove(); } ) );
		if ( nota.estado === 'borrador' ) {
			acciones.appendChild( boton( 'retoque-boton retoque-boton--guardar', 'Ver en mis notas', function () { caja.remove(); abrirCajon( nota.id ); } ) );
		}
		if ( datos.desarrollador && nota.estado !== 'borrador' ) {
			var hecha = boton( 'retoque-boton retoque-boton--guardar', '✓ Marcar como hecha', function () {
				hecha.disabled = true;
				pedir( datos.apiNotas + '/' + nota.id, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { estado: 'hecho' } )
				} ).then( function () {
					estado.notas = estado.notas.filter( function ( n ) { return n.id !== nota.id; } );
					pintarPines();
					actualizarBarra();
					aviso( '✓ Nota marcada como hecha.' );
				} ).catch( function ( error ) {
					hecha.disabled = false;
					aviso( 'No se pudo cambiar: ' + error.message, 'error' );
				} );
			} );
			acciones.appendChild( hecha );
		}
		caja.appendChild( acciones );
		document.body.appendChild( caja );
		posicionarDetalle( caja );
	}

	function abrirNotaDeLaUrl() {
		var parametros = new window.URLSearchParams( window.location.search );
		if ( datos.soloNotas && parametros.get( 'retoque_bienvenida' ) ) {
			cambiarModo( 'comentar' );
			aviso( 'Hola. Toca cualquier parte de la página para dejarnos una nota.' );
			if ( window.history && window.history.replaceState ) {
				parametros.delete( 'retoque_bienvenida' );
				var limpia = window.location.pathname + ( parametros.toString() ? '?' + parametros.toString() : '' ) + window.location.hash;
				window.history.replaceState( null, '', limpia );
			}
			return;
		}
		var id = parametros.get( 'retoque_nota' );
		if ( ! id || ! datos.notasActivas ) { return; }
		cambiarModo( 'comentar' );
		var pin = document.querySelector( '.retoque-pin[data-nota="' + escaparCss( id ) + '"]' );
		if ( pin ) {
			pin.scrollIntoView( { behavior: 'smooth', block: 'center' } );
			window.setTimeout( function () {
				var actual = document.querySelector( '.retoque-pin[data-nota="' + escaparCss( id ) + '"]' ) || pin;
				var nota = estado.notas.filter( function ( n ) { return String( n.id ) === id; } )[ 0 ];
				if ( nota ) { abrirDetalleNota( nota, actual ); }
				actual.classList.add( 'es-destacado' );
			}, 600 );
		} else {
			aviso( 'Esa nota ya está marcada como hecha o es de otra página.' );
		}
	}

	/* ------------------------------------------------------------------
	 * Panel "Mis notas": todas las notas agrupadas por página y envío del paquete
	 * ---------------------------------------------------------------- */

	function rutaActual() {
		return '/' + window.location.pathname.replace( /^\/+|\/+$/g, '' );
	}

	function nombreRecordado() {
		try { return window.localStorage.getItem( 'retoque_nombre' ) || ''; } catch ( e ) { return ''; }
	}

	function construirCajon() {
		if ( ui.cajon ) { return; }
		ui.cajonFondo = crear( 'div', 'retoque-cajon-fondo' );
		ui.cajonFondo.hidden = true;
		ui.cajonFondo.addEventListener( 'click', cerrarCajon );

		ui.cajon = crear( 'aside', 'retoque-cajon' );
		ui.cajon.setAttribute( 'role', 'dialog' );
		ui.cajon.setAttribute( 'aria-modal', 'true' );
		ui.cajon.setAttribute( 'aria-labelledby', 'retoque-cajon-titulo' );
		ui.cajon.hidden = true;

		var cabeza = crear( 'header', 'retoque-cajon__cabeza' );
		var titulos = crear( 'div', 'retoque-cajon__titulos' );
		var titulo = crear( 'h2', 'retoque-cajon__titulo', 'Mis notas' );
		titulo.id = 'retoque-cajon-titulo';
		ui.cajonResumen = crear( 'p', 'retoque-cajon__resumen', '' );
		titulos.appendChild( titulo );
		titulos.appendChild( ui.cajonResumen );
		var cerrar = boton( 'retoque-cajon__cerrar', '✕', cerrarCajon );
		cerrar.setAttribute( 'aria-label', 'Cerrar' );
		cabeza.appendChild( titulos );
		cabeza.appendChild( cerrar );

		ui.cajonCuerpo = crear( 'div', 'retoque-cajon__cuerpo' );

		ui.cajonPie = crear( 'footer', 'retoque-cajon__pie' );
		ui.cajonNombre = null;
		if ( datos.pedirNombre ) {
			ui.cajonNombre = crear( 'input', 'retoque-panel__campo retoque-cajon__nombre' );
			ui.cajonNombre.type = 'text';
			ui.cajonNombre.id = 'retoque-cajon-nombre';
			ui.cajonNombre.placeholder = 'Tu nombre';
			ui.cajonNombre.autocomplete = 'name';
			ui.cajonNombre.setAttribute( 'aria-label', 'Tu nombre' );
			ui.cajonPie.appendChild( ui.cajonNombre );
		}
		// Aviso cuando las notas estén hechas (1.13).
		ui.cajonCorreo = null;
		if ( datos.pedirNombre ) {
			ui.cajonCorreo = crear( 'input', 'retoque-panel__campo retoque-cajon__nombre' );
			ui.cajonCorreo.type = 'email';
			ui.cajonCorreo.placeholder = 'Tu correo (opcional): te avisamos cuando esté listo';
			ui.cajonCorreo.autocomplete = 'email';
			ui.cajonCorreo.setAttribute( 'aria-label', 'Tu correo para avisarte cuando los cambios estén listos' );
			try { ui.cajonCorreo.value = window.localStorage.getItem( 'retoque_correo' ) || ''; } catch ( e ) {}
			ui.cajonPie.appendChild( ui.cajonCorreo );
		}
		var botones = crear( 'div', 'retoque-cajon__botones' );
		ui.cajonSeguir = boton( 'retoque-boton retoque-boton--suave', 'Seguir comentando', cerrarCajon );
		ui.cajonEnviar = boton( 'retoque-boton retoque-boton--guardar', 'Enviar notas', enviarPaquete );
		botones.appendChild( ui.cajonSeguir );
		botones.appendChild( ui.cajonEnviar );
		ui.cajonPie.appendChild( botones );
		ui.cajonAyuda = crear( 'p', 'retoque-cajon__ayuda', 'Envíalas cuando termines: le llegan al equipo en un solo correo, ordenadas por página.' + ( datos.correoAviso ? ' Te avisaremos a ' + datos.correoAviso + ' cuando estén hechas.' : '' ) );
		ui.cajonPie.appendChild( ui.cajonAyuda );

		ui.cajon.appendChild( cabeza );
		ui.cajon.appendChild( ui.cajonCuerpo );
		ui.cajon.appendChild( ui.cajonPie );
		document.body.appendChild( ui.cajonFondo );
		document.body.appendChild( ui.cajon );

		ui.cajon.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Escape' ) { e.preventDefault(); cerrarCajon(); }
		} );
	}

	function abrirCajon( destacar ) {
		construirCajon();
		Array.prototype.forEach.call( document.querySelectorAll( '.retoque-pin-detalle' ), function ( el ) { el.remove(); } );
		cerrarPanel();
		ui.cajonFondo.hidden = false;
		ui.cajon.hidden = false;
		document.documentElement.classList.add( 'retoque-cajon-abierto' );
		window.requestAnimationFrame( function () { ui.cajon.classList.add( 'es-visible' ); ui.cajonFondo.classList.add( 'es-visible' ); } );
		if ( ui.cajonNombre && ! ui.cajonNombre.value ) { ui.cajonNombre.value = nombreRecordado(); }
		ui.cajon.querySelector( '.retoque-cajon__cerrar' ).focus();
		cargarLista( destacar );
	}

	function cerrarCajon() {
		if ( ! ui.cajon || ui.cajon.hidden ) { return; }
		ui.cajon.classList.remove( 'es-visible' );
		ui.cajonFondo.classList.remove( 'es-visible' );
		document.documentElement.classList.remove( 'retoque-cajon-abierto' );
		window.setTimeout( function () { ui.cajon.hidden = true; ui.cajonFondo.hidden = true; }, 220 );
		if ( ui.verNotas && ! ui.verNotas.hidden ) { ui.verNotas.focus(); }
	}

	function cargarLista( destacar ) {
		ui.cajonCuerpo.innerHTML = '';
		ui.cajonCuerpo.appendChild( crear( 'p', 'retoque-cajon__vacio', 'Cargando notas…' ) );
		pedir( datos.apiLista, { method: 'POST' } )
			.then( function ( lista ) { pintarLista( lista, destacar ); } )
			.catch( function ( error ) {
				ui.cajonCuerpo.innerHTML = '';
				ui.cajonCuerpo.appendChild( crear( 'p', 'retoque-cajon__vacio', 'No se pudieron cargar las notas: ' + error.message ) );
			} );
	}

	function pintarLista( lista, destacar ) {
		estado.porEnviar = lista.por_enviar || 0;
		actualizarBarra();

		// Las notas de esta página también se actualizan en los marcadores.
		var aqui = rutaActual();
		estado.notas = [];
		( lista.grupos || [] ).forEach( function ( grupo ) {
			if ( grupo.ruta === aqui ) { estado.notas = grupo.notas.slice(); }
		} );
		pintarPines();

		var partes = [];
		if ( lista.por_enviar ) { partes.push( lista.por_enviar + ' por enviar' ); }
		if ( lista.enviadas ) { partes.push( lista.enviadas + ' enviadas' ); }
		if ( lista.hechas ) { partes.push( lista.hechas + ' hechas' ); }
		ui.cajonResumen.textContent = partes.length ? partes.join( ' · ' ) : 'Todavía no hay notas';

		ui.cajonEnviar.disabled = ! lista.por_enviar;
		ui.cajonEnviar.textContent = lista.por_enviar ? 'Enviar ' + lista.por_enviar + ( lista.por_enviar === 1 ? ' nota' : ' notas' ) : 'Enviar notas';
		if ( ui.cajonNombre ) { ui.cajonNombre.hidden = ! lista.por_enviar; }

		ui.cajonCuerpo.innerHTML = '';
		if ( ! lista.grupos || ! lista.grupos.length ) {
			var vacio = crear( 'div', 'retoque-cajon__vacio' );
			vacio.appendChild( crear( 'p', '', 'Todavía no hay notas.' ) );
			vacio.appendChild( crear( 'p', '', 'Cierra este panel y toca cualquier parte de la página para dejar la primera.' ) );
			ui.cajonCuerpo.appendChild( vacio );
			return;
		}

		var numero = 1;
		lista.grupos.forEach( function ( grupo ) {
			var seccion = crear( 'section', 'retoque-grupo' + ( grupo.ruta === aqui ? ' es-actual' : '' ) );
			var cabeza = crear( 'h3', 'retoque-grupo__titulo' );
			cabeza.appendChild( document.createTextNode( 'Notas de ' + grupo.titulo ) );
			cabeza.appendChild( crear( 'span', 'retoque-grupo__cuenta', String( grupo.notas.length ) ) );
			if ( grupo.ruta === aqui ) { cabeza.appendChild( crear( 'span', 'retoque-grupo__aqui', 'Estás aquí' ) ); }
			seccion.appendChild( cabeza );
			grupo.notas.forEach( function ( nota ) {
				var tarjeta = tarjetaNota( nota, grupo, numero++ );
				if ( destacar && nota.id === destacar ) {
					tarjeta.classList.add( 'es-destacada' );
					window.setTimeout( function () { tarjeta.scrollIntoView( { block: 'center' } ); }, 50 );
				}
				seccion.appendChild( tarjeta );
			} );
			ui.cajonCuerpo.appendChild( seccion );
		} );
	}

	function tarjetaNota( nota, grupo, numero ) {
		var tarjeta = crear( 'article', 'retoque-nota retoque-nota--' + nota.estado );
		var arriba = crear( 'div', 'retoque-nota__arriba' );
		arriba.appendChild( crear( 'span', 'retoque-nota__numero', String( numero ) ) );
		arriba.appendChild( crear( 'span', 'retoque-estado-nota retoque-estado-nota--' + nota.estado, nota.estado_nombre ) );
		tarjeta.appendChild( arriba );
		if ( nota.tocado ) {
			tarjeta.appendChild( crear( 'p', 'retoque-nota__tocado', '«' + nota.tocado + '»' ) );
		}
		var texto = crear( 'p', 'retoque-nota__texto', nota.texto );
		tarjeta.appendChild( texto );
		if ( nota.imagen ) {
			var foto = crear( 'a', 'retoque-nota__foto' );
			foto.href = nota.imagen_full || nota.imagen;
			foto.target = '_blank';
			foto.rel = 'noopener';
			var img = crear( 'img' );
			img.src = nota.imagen;
			img.alt = 'Foto adjunta';
			img.loading = 'lazy';
			foto.appendChild( img );
			tarjeta.appendChild( foto );
		}
		pintarEnlaceNota( tarjeta, nota, 'retoque-nota__enlace' );
		tarjeta.appendChild( crear( 'p', 'retoque-nota__meta', nota.autor + ' · ' + nota.fecha + ( datos.desarrollador && nota.contenedor ? ' · ' + nota.contenedor : '' ) ) );

		var acciones = crear( 'div', 'retoque-nota__acciones' );
		acciones.appendChild( boton( 'retoque-nota__accion', 'Ver', function () { irANota( nota, grupo ); } ) );
		if ( nota.estado === 'borrador' ) {
			acciones.appendChild( boton( 'retoque-nota__accion', 'Editar', function () { editarEnCajon( nota, tarjeta, texto ); } ) );
			acciones.appendChild( boton( 'retoque-nota__accion retoque-nota__accion--peligro', 'Borrar', function () { confirmarBorrado( nota, tarjeta, acciones ); } ) );
		} else if ( datos.desarrollador && nota.estado === 'pendiente' ) {
			acciones.appendChild( boton( 'retoque-nota__accion', '✓ Hecha', function () {
				cambiarNota( nota.id, { estado: 'hecho' } ).then( function () { cargarLista(); aviso( '✓ Nota marcada como hecha.' ); } );
			} ) );
		}
		tarjeta.appendChild( acciones );
		return tarjeta;
	}

	function cambiarNota( id, cuerpo ) {
		return pedir( datos.apiNotas + '/' + id, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( cuerpo )
		} ).catch( function ( error ) {
			aviso( error.message, 'error' );
			throw error;
		} );
	}

	function irANota( nota, grupo ) {
		if ( grupo.ruta === rutaActual() ) {
			cerrarCajon();
			if ( estado.modo !== 'comentar' ) { cambiarModo( 'comentar' ); }
			var pin = document.querySelector( '.retoque-pin[data-nota="' + nota.id + '"]' );
			if ( pin ) {
				pin.scrollIntoView( { behavior: 'smooth', block: 'center' } );
				window.setTimeout( function () {
					var actual = document.querySelector( '.retoque-pin[data-nota="' + nota.id + '"]' ) || pin;
					abrirDetalleNota( nota, actual );
				}, 450 );
			}
			return;
		}
		var url = nota.url || grupo.url;
		window.location.href = url + ( url.indexOf( '?' ) === -1 ? '?' : '&' ) + 'retoque_nota=' + nota.id;
	}

	function editarEnCajon( nota, tarjeta, texto ) {
		if ( tarjeta.querySelector( 'textarea' ) ) { return; }
		var campo = crear( 'textarea', 'retoque-panel__campo retoque-nota__campo' );
		campo.value = nota.texto;
		campo.rows = 4;
		campo.setAttribute( 'aria-label', 'Editar nota' );
		var link = crear( 'input', 'retoque-panel__campo retoque-nota__campo' );
		link.type = 'url';
		link.value = nota.enlace || '';
		link.placeholder = 'Enlace (opcional): https://…';
		link.setAttribute( 'aria-label', 'Enlace de la nota' );
		var fila = crear( 'div', 'retoque-nota__acciones' );
		var guardarCambio = boton( 'retoque-nota__accion retoque-nota__accion--principal', 'Guardar', function () {
			var valor = campo.value.trim();
			if ( ! valor ) { aviso( 'La nota no puede quedar vacía. Si ya no la necesitas, bórrala.', 'error' ); return; }
			var enlace = normalizarEnlace( link.value, nota.red ? REDES.filter( function ( r ) { return r.nombre === nota.red; } )[ 0 ] : null );
			if ( enlace === null ) { aviso( 'Ese enlace no parece válido. Cópialo desde la barra de direcciones (empieza con https://).', 'error' ); link.focus(); return; }
			guardarCambio.disabled = true;
			cambiarNota( nota.id, { accion: 'editar', texto: valor, enlace: enlace } )
				.then( function () { cargarLista( nota.id ); aviso( '✓ Nota actualizada.' ); } )
				.catch( function () { guardarCambio.disabled = false; } );
		} );
		var cancelar = boton( 'retoque-nota__accion', 'Cancelar', function () { campo.remove(); link.remove(); fila.remove(); texto.hidden = false; } );
		fila.appendChild( cancelar );
		fila.appendChild( guardarCambio );
		texto.hidden = true;
		texto.insertAdjacentElement( 'afterend', campo );
		campo.insertAdjacentElement( 'afterend', link );
		link.insertAdjacentElement( 'afterend', fila );
		campo.focus();
	}

	function confirmarBorrado( nota, tarjeta, acciones ) {
		var original = Array.prototype.slice.call( acciones.childNodes );
		acciones.innerHTML = '';
		acciones.appendChild( crear( 'span', 'retoque-nota__pregunta', '¿Borrar esta nota?' ) );
		acciones.appendChild( boton( 'retoque-nota__accion', 'No', function () {
			acciones.innerHTML = '';
			original.forEach( function ( n ) { acciones.appendChild( n ); } );
		} ) );
		var si = boton( 'retoque-nota__accion retoque-nota__accion--peligro', 'Sí, borrar', function () {
			si.disabled = true;
			cambiarNota( nota.id, { accion: 'borrar' } ).then( function () {
				tarjeta.classList.add( 'es-borrada' );
				window.setTimeout( function () { cargarLista(); }, 200 );
			} ).catch( function () { si.disabled = false; } );
		} );
		acciones.appendChild( si );
	}

	function enviarPaquete() {
		var cuerpo = {};
		if ( ui.cajonNombre ) {
			var nombre = ui.cajonNombre.value.trim();
			if ( ! nombre ) {
				aviso( 'Escribe tu nombre para que sepamos quién envía las notas.', 'error' );
				ui.cajonNombre.focus();
				return;
			}
			try { window.localStorage.setItem( 'retoque_nombre', nombre ); } catch ( e ) {}
			cuerpo.nombre = nombre;
		}
		if ( ui.cajonCorreo && ui.cajonCorreo.value.trim() ) {
			if ( ! ui.cajonCorreo.checkValidity() ) {
				aviso( 'Revisa tu correo: no parece válido.', 'error' );
				ui.cajonCorreo.focus();
				return;
			}
			cuerpo.correo = ui.cajonCorreo.value.trim();
			try { window.localStorage.setItem( 'retoque_correo', cuerpo.correo ); } catch ( e ) {}
		}
		ui.cajonEnviar.disabled = true;
		ui.cajonEnviar.textContent = 'Enviando…';
		pedir( datos.apiEnviar, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( cuerpo )
		} )
			.then( function ( respuesta ) {
				estado.porEnviar = 0;
				actualizarBarra();
				ui.cajonCuerpo.innerHTML = '';
				var listo = crear( 'div', 'retoque-cajon__listo' );
				listo.appendChild( crear( 'span', 'retoque-cajon__check', '✓' ) );
				listo.appendChild( crear( 'p', 'retoque-cajon__listo-titulo', respuesta.enviadas === 1 ? 'Enviamos tu nota al equipo' : 'Enviamos tus ' + respuesta.enviadas + ' notas al equipo' ) );
				listo.appendChild( crear( 'p', '', respuesta.correo === false
					? 'Quedaron guardadas, pero el correo no salió. Avísale al equipo: igual las ve en su panel.'
					: 'Te avisaremos cuando estén listas. Puedes seguir dejando notas: las nuevas quedan por enviar.' ) );
				listo.appendChild( boton( 'retoque-boton retoque-boton--suave', 'Ver todas las notas', function () { cargarLista(); } ) );
				ui.cajonCuerpo.appendChild( listo );
				ui.cajonResumen.textContent = respuesta.enviadas + ' enviadas';
				ui.cajonEnviar.textContent = 'Enviar notas';
				if ( ui.cajonNombre ) { ui.cajonNombre.hidden = true; }
				if ( ui.cajonCorreo ) { ui.cajonCorreo.hidden = true; }
				// Los marcadores de esta página pasan a "Enviada".
				estado.notas.forEach( function ( n ) { if ( n.estado === 'borrador' ) { n.estado = 'pendiente'; n.estado_nombre = 'Enviada'; } } );
				pintarPines();
			} )
			.catch( function ( error ) {
				ui.cajonEnviar.disabled = false;
				ui.cajonEnviar.textContent = 'Enviar notas';
				aviso( 'No se pudieron enviar: ' + error.message, 'error' );
			} );
	}

	/* ------------------------------------------------------------------
	 * Eventos de la página
	 * ---------------------------------------------------------------- */

	function dentroDeInterfaz( objetivo ) {
		return !! ( objetivo && objetivo.closest && objetivo.closest(
			'.retoque-barra, .retoque-chip, .retoque-panel, .retoque-pin, .retoque-pin-detalle, .retoque-etiqueta-contenedor, .retoque-cajon, .retoque-cajon-fondo, ' +
			'.retoque-controles-item, .retoque-agregar, .retoque-aviso, .media-modal, .media-modal-backdrop, #wpadminbar'
		) );
	}

	function alHacerClic( e ) {
		var objetivo = e.target;

		// Botón de la barra de administración.
		var botonBarra = objetivo.closest && objetivo.closest( '#wp-admin-bar-retoque-editar a' );
		if ( botonBarra ) {
			e.preventDefault();
			cambiarModo( estado.modo === 'editar' ? '' : 'editar' );
			return;
		}

		if ( ! estado.modo || dentroDeInterfaz( objetivo ) ) { return; }

		// Comentar: el clic no hace nada más que abrir la nota.
		if ( estado.modo === 'comentar' ) {
			e.preventDefault();
			e.stopPropagation();
			Array.prototype.forEach.call( document.querySelectorAll( '.retoque-pin-detalle' ), function ( el ) { el.remove(); } );
			abrirPanelNota( objetivo, e );
			return;
		}

		var editable = objetivo.closest( '[data-retoque]' );
		if ( ! editable ) {
			editable = fondoEn( e.clientX, e.clientY ); // Se tocó el fondo: el del contenedor o una imagen tapada.
		}

		// En modo edición no se navega: así un clic en un botón no te saca de la página.
		if ( objetivo.closest( 'a, button, [type="submit"]' ) ) {
			e.preventDefault();
		}

		if ( ! editable ) {
			deseleccionar();
			var externo = objetivo.closest( '[data-retoque-externo-donde]' );
			if ( externo ) { mostrarExterno( externo, e ); }
			return;
		}

		var tipo = esFondo( editable ) ? 'fondo' : editable.getAttribute( 'data-retoque-tipo' );
		if ( editable !== estado.seleccionado ) {
			seleccionar( editable );
			if ( tipo === 'imagen' ) { elegirImagen( editable ); }
			if ( tipo === 'enlace' ) { abrirPanelEnlace( editable ); }
			if ( tipo === 'opcion' ) { abrirPanelOpcion( editable ); }
		}
	}

	function alEnviarFormulario( e ) {
		// Mientras se edita o comenta, los formularios del sitio no se envían.
		if ( estado.modo && ! dentroDeInterfaz( e.target ) ) {
			e.preventDefault();
		}
	}

	function alPasarEncima( e ) {
		if ( estado.modo !== 'comentar' ) { return; }
		var anterior = document.querySelector( '.retoque-objetivo' );
		if ( anterior ) { anterior.classList.remove( 'retoque-objetivo' ); }
		if ( ! dentroDeInterfaz( e.target ) && e.target !== document.body && e.target !== document.documentElement ) {
			e.target.classList.add( 'retoque-objetivo' );
		}
	}

	function alPresionarTecla( e ) {
		if ( e.key === 'Escape' && ui.cajon && ! ui.cajon.hidden ) {
			cerrarCajon();
			return;
		}
		if ( estado.modo !== 'editar' ) { return; }
		var el = estado.seleccionado;

		if ( ( e.ctrlKey || e.metaKey ) && e.key && e.key.toLowerCase() === 's' ) {
			e.preventDefault();
			guardar();
			return;
		}
		if ( e.key === 'Escape' ) {
			deseleccionar();
			return;
		}
		if ( el && el.isContentEditable && e.key === 'Enter' ) {
			var tipo = el.getAttribute( 'data-retoque-tipo' );
			if ( tipo === 'texto' ) {
				e.preventDefault();
				deseleccionar();
			} else if ( tipo === 'parrafo' && el.contentEditable === 'true' ) {
				// Párrafo sin soporte de plaintext-only: insertar salto simple.
				e.preventDefault();
				document.execCommand( 'insertLineBreak' );
			}
		}
		// Enter o espacio sobre un editable enfocado con el teclado lo selecciona.
		if ( ! el && ( e.key === 'Enter' || e.key === ' ' ) && document.activeElement && document.activeElement.hasAttribute( 'data-retoque' ) ) {
			e.preventDefault();
			document.activeElement.click();
		}
	}

	function alPegar( e ) {
		var el = e.target.closest && e.target.closest( '[data-retoque]' );
		if ( ! el || ! el.isContentEditable ) { return; }
		e.preventDefault();
		var texto = ( e.clipboardData || window.clipboardData ).getData( 'text' );
		if ( el.getAttribute( 'data-retoque-tipo' ) === 'texto' ) {
			texto = texto.replace( /\s*\n\s*/g, ' ' );
		}
		document.execCommand( 'insertText', false, texto );
	}

	function alSalirDeLaPagina( e ) {
		if ( estado.seleccionado && estado.seleccionado.isContentEditable ) {
			deseleccionar();
		}
		if ( cantidadCambios() > 0 ) {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	function recolocar() {
		posicionarChip( estado.seleccionado );
		pintarEtiquetasContenedores();
		pintarPines();
	}

	function iniciar() {
		// Quien edita o revisa ve los avisos de información que falta (para los visitantes siguen ocultos).
		Array.prototype.forEach.call( document.querySelectorAll( '[data-retoque-falta][hidden]' ), function ( el ) {
			el.removeAttribute( 'hidden' );
		} );
		construirInterfaz();

		document.addEventListener( 'click', alHacerClic, true );
		document.addEventListener( 'submit', alEnviarFormulario, true );
		document.addEventListener( 'mouseover', alPasarEncima );
		document.addEventListener( 'keydown', alPresionarTecla );
		document.addEventListener( 'paste', alPegar );
		document.addEventListener( 'input', alEscribir );
		document.addEventListener( 'input', actualizarFaltas );
		window.addEventListener( 'beforeunload', alSalirDeLaPagina );
		window.addEventListener( 'resize', recolocar );
		window.addEventListener( 'load', recolocar );
		// Un filtro, un menú o una imagen nueva cambian el tamaño de las secciones: se recolocan marcas y nombres.
		document.addEventListener( 'click', function () {
			if ( estado.verContenedores || estado.modo === 'comentar' ) { window.setTimeout( recolocar, 350 ); }
		} );
		document.addEventListener( 'focusout', function ( e ) {
			// Al salir de un texto editado con teclado (Tab), se registra el cambio.
			var el = e.target;
			if ( el === estado.seleccionado && el.isContentEditable ) {
				window.setTimeout( function () {
					if ( estado.seleccionado === el && ! el.contains( document.activeElement ) && ! dentroDeInterfaz( document.activeElement || document.body ) ) {
						deseleccionar();
					}
				}, 150 );
			}
		} );

		var modo = leerSesion();
		if ( window.location.hash === '#retoque' ) { modo = 'editar'; }
		if ( modo === 'editar' || modo === 'comentar' ) { cambiarModo( modo ); }
		abrirNotaDeLaUrl();
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', iniciar );
	} else {
		iniciar();
	}
}() );
