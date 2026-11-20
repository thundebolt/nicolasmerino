/* Retoque 1.13.1 · estilo.js (en la demo solo se activa en la vista de desarrollador) */
if ( window.RETOQUE_DEMO_ROL === 'desarrollador' ) {
/**
 * Retoque · Modo Estilo (solo desarrolladores).
 *
 * Agrega «Estilo» a la barra de edición. En este modo:
 *   - tocar un elemento abre un panel para cambiar su tamaño de texto (PC y celular),
 *     su color de texto, su color de fondo, u ocultarlo;
 *   - «Colores del sitio» cambia las variables de color del tema (las de :root).
 * Los cambios se ven al instante y se guardan con «Guardar». El CSS que ven los visitantes
 * lo arma el servidor (incluye/estilo.php → retoque_css_estilos) con las mismas reglas que css() aquí.
 */
( function () {
	'use strict';

	var datos = window.RetoqueEstilo || {};
	var CORTE = parseInt( datos.corte, 10 ) || 767;
	var CLAVE_SESION = 'retoque_estilo';
	var RAICES = [ 'header', 'main', 'footer', 'nav', 'aside' ];
	var INTERFAZ = '.retoque-barra, .retoque-estilo-barra, .retoque-estilo-panel, .retoque-chip, .retoque-panel, .retoque-pin, ' +
		'.retoque-pin-detalle, .retoque-cajon, .retoque-cajon-fondo, .retoque-aviso, .media-modal, .media-modal-backdrop, #wpadminbar';

	var estado = {
		activo: false,
		colores: objeto( datos.estilos && datos.estilos.colores ),
		reglas: objeto( datos.estilos && datos.estilos.reglas ),
		guardado: '',
		originales: {},     // variable -> color original del tema
		elegido: null,
		panel: null,        // { el, unico, iguales, modo: 'este'|'iguales', sitio: bool, celularManual: bool }
		guardando: false
	};
	estado.guardado = foto();

	var ui = {};

	/* ------------------------------------------------------------------
	 * Utilidades
	 * ---------------------------------------------------------------- */

	function objeto( valor ) {
		// PHP manda [] cuando el arreglo está vacío.
		return valor && ! Array.isArray( valor ) && typeof valor === 'object' ? JSON.parse( JSON.stringify( valor ) ) : {};
	}

	function foto() {
		return JSON.stringify( { colores: estado.colores, reglas: estado.reglas } );
	}

	function crear( etiqueta, clase, texto ) {
		var el = document.createElement( etiqueta );
		if ( clase ) { el.className = clase; }
		if ( texto !== undefined ) { el.textContent = texto; }
		return el;
	}

	function boton( clase, texto, alHacer ) {
		var b = crear( 'button', clase, texto );
		b.type = 'button';
		b.addEventListener( 'click', function ( e ) { e.preventDefault(); alHacer( e ); } );
		return b;
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

	function sesion( valor ) {
		try {
			if ( valor === undefined ) { return window.sessionStorage.getItem( CLAVE_SESION ) === '1'; }
			if ( valor ) { window.sessionStorage.setItem( CLAVE_SESION, '1' ); } else { window.sessionStorage.removeItem( CLAVE_SESION ); }
		} catch ( e ) { /* Sin almacenamiento: el modo no se recuerda al recargar. */ }
		return false;
	}

	function dentroDeInterfaz( el ) {
		return !! ( el && el.closest && el.closest( INTERFAZ ) );
	}

	function aHex( color ) {
		if ( ! color ) { return ''; }
		color = String( color ).trim().toLowerCase();
		var corto = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec( color );
		if ( corto ) { return '#' + corto[1] + corto[1] + corto[2] + corto[2] + corto[3] + corto[3]; }
		if ( /^#[0-9a-f]{6}$/.test( color ) ) { return color; }
		var rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec( color );
		if ( ! rgb ) { return ''; }
		if ( rgb[4] !== undefined && parseFloat( rgb[4] ) === 0 ) { return ''; }
		return '#' + [ rgb[1], rgb[2], rgb[3] ].map( function ( n ) {
			return ( '0' + Math.min( 255, parseInt( n, 10 ) ).toString( 16 ) ).slice( -2 );
		} ).join( '' );
	}

	function esCelular() {
		return window.innerWidth <= CORTE;
	}

	/* ------------------------------------------------------------------
	 * CSS (igual que retoque_css_estilos en PHP)
	 * ---------------------------------------------------------------- */

	function unir( cuerpo, selector ) {
		return selector.indexOf( 'body' ) === 0 ? cuerpo + selector.slice( 4 ) : cuerpo + ' ' + selector;
	}

	function css( vivo ) {
		var salida = '', celular = '', pc = '';
		var variables = Object.keys( estado.colores );
		if ( variables.length ) {
			salida += ':root{' + variables.map( function ( v ) { return v + ':' + estado.colores[ v ] + ';'; } ).join( '' ) + '}';
		}
		Object.keys( estado.reglas ).forEach( function ( clave ) {
			var r = estado.reglas[ clave ];
			var cuerpo = 'body' + ( r.vista ? '.retoque-vista-' + r.vista : '' );
			var sel = unir( cuerpo, r.selector );
			var oculto = unir( cuerpo + ':not(.retoque-estilando)', r.selector );
			// Mientras se edita el estilo, lo oculto se ve tenue y rayado para poder tocarlo y mostrarlo de nuevo.
			var marca = vivo ? unir( cuerpo + '.retoque-estilando', r.selector ) + '{opacity:.35!important;outline:2px dashed #dc2626!important;outline-offset:-2px!important;}' : '';
			var base = '';
			if ( r.color ) { base += 'color:' + r.color + '!important;'; }
			if ( r.fondo ) { base += 'background-color:' + r.fondo + '!important;background-image:none!important;'; }
			if ( r.tamano_pc ) { base += 'font-size:' + r.tamano_pc + 'px!important;'; }
			if ( base ) { salida += sel + '{' + base + '}'; }
			if ( r.tamano_celular ) { celular += sel + '{font-size:' + r.tamano_celular + 'px!important;}'; }
			if ( r.ocultar === 'todo' ) {
				salida += oculto + '{display:none!important;}' + marca;
			} else if ( r.ocultar === 'celular' ) {
				celular += oculto + '{display:none!important;}' + marca;
			} else if ( r.ocultar === 'pc' ) {
				pc += oculto + '{display:none!important;}' + marca;
			}
		} );
		if ( celular ) { salida += '@media (max-width:' + CORTE + 'px){' + celular + '}'; }
		if ( pc ) { salida += '@media (min-width:' + ( CORTE + 1 ) + 'px){' + pc + '}'; }
		return salida;
	}

	function pintarCss() {
		// El <style> del servidor se apaga: desde ahora manda el del editor, que se actualiza en vivo.
		var servidor = document.getElementById( 'retoque-estilos' );
		if ( servidor ) { servidor.media = 'not all'; }
		if ( ! ui.css ) {
			ui.css = crear( 'style' );
			ui.css.id = 'retoque-estilos-vivo';
			document.head.appendChild( ui.css );
		}
		ui.css.textContent = css( true );
	}

	/* ------------------------------------------------------------------
	 * Cómo se nombra un elemento (selector CSS estable)
	 * ---------------------------------------------------------------- */

	function clasesUtiles( el ) {
		return Array.prototype.filter.call( el.classList, function ( c ) {
			return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test( c ) &&
				! /^(retoque-|es-|is-|esta-|has-|wp-image-)/.test( c ) &&
				! /^(activo|activa|abierto|abierta|active|open|visible|oculto|selected|current|current-menu-item|current_page_item|current-menu-parent)$/.test( c );
		} ).slice( 0, 2 );
	}

	function idUtil( el ) {
		var id = el.id;
		return id && /^[A-Za-z][A-Za-z0-9_-]*$/.test( id ) && id.indexOf( 'retoque' ) !== 0 && document.querySelectorAll( '#' + id ).length === 1 ? id : '';
	}

	function parte( el ) {
		var etiqueta = el.tagName.toLowerCase();
		var texto = etiqueta + clasesUtiles( el ).map( function ( c ) { return '.' + c; } ).join( '' );
		var padre = el.parentElement;
		if ( padre ) {
			var hermanos = Array.prototype.filter.call( padre.children, function ( h ) { return h.tagName === el.tagName; } );
			if ( hermanos.length > 1 ) { texto += ':nth-of-type(' + ( hermanos.indexOf( el ) + 1 ) + ')'; }
		}
		return texto;
	}

	/** Selector que apunta solo a este elemento. */
	function selectorUnico( el ) {
		var partes = [];
		var actual = el;
		while ( actual && actual !== document.body && actual !== document.documentElement ) {
			var id = idUtil( actual );
			if ( id ) { partes.unshift( '#' + id ); return partes.join( ' > ' ); }
			var etiqueta = actual.tagName.toLowerCase();
			if ( RAICES.indexOf( etiqueta ) > -1 && document.getElementsByTagName( etiqueta ).length === 1 ) {
				partes.unshift( etiqueta );
				return partes.join( ' > ' );
			}
			partes.unshift( parte( actual ) );
			actual = actual.parentElement;
		}
		partes.unshift( 'body' );
		return partes.join( ' > ' );
	}

	/** Selector de todos los elementos iguales (mismas clases), o '' si no hay otros. */
	function selectorIguales( el ) {
		var clases = clasesUtiles( el );
		var etiqueta = el.tagName.toLowerCase();
		var selector = '';
		if ( clases.length ) {
			selector = etiqueta + '.' + clases.join( '.' );
		} else if ( el.parentElement && clasesUtiles( el.parentElement ).length ) {
			selector = '.' + clasesUtiles( el.parentElement ).join( '.' ) + ' > ' + etiqueta;
		}
		if ( ! selector ) { return ''; }
		try {
			return contar( selector ) > 1 ? selector : '';
		} catch ( e ) {
			return '';
		}
	}

	function contar( selector ) {
		return Array.prototype.filter.call( document.querySelectorAll( selector ), function ( n ) { return ! dentroDeInterfaz( n ); } ).length;
	}

	function tipoDe( el ) {
		var etiqueta = el.tagName.toLowerCase();
		var clases = ( el.getAttribute( 'class' ) || '' ).toLowerCase();
		if ( /^h[1-6]$/.test( etiqueta ) ) { return 'Título'; }
		if ( etiqueta === 'button' || ( etiqueta === 'a' && /bot|btn|button/.test( clases ) ) ) { return 'Botón'; }
		if ( etiqueta === 'a' ) { return 'Enlace'; }
		if ( etiqueta === 'img' || etiqueta === 'picture' ) { return 'Imagen'; }
		if ( etiqueta === 'section' ) { return 'Sección'; }
		if ( etiqueta === 'header' ) { return 'Cabecera'; }
		if ( etiqueta === 'footer' ) { return 'Pie de página'; }
		if ( etiqueta === 'nav' ) { return 'Menú'; }
		if ( etiqueta === 'ul' || etiqueta === 'ol' ) { return 'Lista'; }
		if ( etiqueta === 'li' ) { return 'Elemento de lista'; }
		if ( [ 'p', 'span', 'strong', 'em', 'small', 'label', 'blockquote' ].indexOf( etiqueta ) > -1 ) { return 'Texto'; }
		return 'Bloque';
	}

	function nombreDe( el ) {
		// Una sección o un bloque se nombran por su título, si tienen.
		var titulo = /^(section|div|article|header|footer|aside|main|ul|ol|li)$/i.test( el.tagName ) ? el.querySelector( 'h1, h2, h3, h4' ) : null;
		var texto = ( ( titulo || el ).textContent || el.getAttribute( 'alt' ) || '' ).replace( /\s+/g, ' ' ).trim();
		if ( texto.length > 38 ) { texto = texto.slice( 0, 36 ) + '…'; }
		return tipoDe( el ) + ( texto ? ' «' + texto + '»' : '' );
	}

	/** Lo que está en la cabecera o el pie se repite en todas las páginas: por defecto vale para todo el sitio. */
	function esDeTodoElSitio( el ) {
		return !! el.closest( 'body > header, body > footer, #wpadminbar, header.cabecera, footer.pie, .navbar' );
	}

	/* ------------------------------------------------------------------
	 * Reglas
	 * ---------------------------------------------------------------- */

	function claveActual() {
		var p = estado.panel;
		var selector = p.modo === 'iguales' && p.iguales ? p.iguales : p.unico;
		var vista = p.sitio || ! datos.vista ? '' : datos.vista;
		return { clave: vista + '|' + selector, selector: selector, vista: vista };
	}

	function reglaActual() {
		var c = claveActual();
		return estado.reglas[ c.clave ] || null;
	}

	/** Cambia una propiedad de la regla del elemento elegido y repinta. */
	function cambiar( propiedad, valor ) {
		var c = claveActual();
		var regla = estado.reglas[ c.clave ] || {
			selector: c.selector,
			vista: c.vista,
			nombre: ( estado.panel.modo === 'iguales' ? 'Todos: ' : '' ) + nombreDe( estado.panel.el ),
			tamano_pc: 0,
			tamano_celular: 0,
			color: '',
			fondo: '',
			ocultar: ''
		};
		regla[ propiedad ] = valor;
		if ( ! regla.tamano_pc && ! regla.tamano_celular && ! regla.color && ! regla.fondo && ! regla.ocultar ) {
			delete estado.reglas[ c.clave ];
		} else {
			estado.reglas[ c.clave ] = regla;
		}
		pintarCss();
		actualizarBarra();
	}

	/** Al cambiar «Aplicar a» o «Dónde», los cambios ya hechos se mueven a la nueva regla. */
	function moverRegla( alCambiar ) {
		var antes = claveActual();
		var regla = estado.reglas[ antes.clave ];
		alCambiar();
		var despues = claveActual();
		if ( regla && antes.clave !== despues.clave ) {
			delete estado.reglas[ antes.clave ];
			regla.selector = despues.selector;
			regla.vista = despues.vista;
			regla.nombre = ( estado.panel.modo === 'iguales' ? 'Todos: ' : '' ) + nombreDe( estado.panel.el );
			estado.reglas[ despues.clave ] = regla;
			pintarCss();
		}
		abrirPanelElemento( estado.panel.el, true );
	}

	function cantidadCambios() {
		var antes = JSON.parse( estado.guardado );
		var n = 0;
		var claves = {};
		Object.keys( antes.colores ).concat( Object.keys( estado.colores ) ).forEach( function ( k ) { claves[ 'c' + k ] = k; } );
		Object.keys( claves ).forEach( function ( k ) {
			var v = claves[ k ];
			if ( antes.colores[ v ] !== estado.colores[ v ] ) { n++; }
		} );
		claves = {};
		Object.keys( antes.reglas ).concat( Object.keys( estado.reglas ) ).forEach( function ( k ) { claves[ k ] = true; } );
		Object.keys( claves ).forEach( function ( k ) {
			if ( JSON.stringify( antes.reglas[ k ] || null ) !== JSON.stringify( estado.reglas[ k ] || null ) ) { n++; }
		} );
		return n;
	}

	/* ------------------------------------------------------------------
	 * Interfaz
	 * ---------------------------------------------------------------- */

	function construir() {
		var barraEditor = document.querySelector( '.retoque-barra' );
		if ( barraEditor ) {
			ui.entrar = boton( 'retoque-boton retoque-boton--suave retoque-boton--estilo', 'Estilo', function () { activar( true ); } );
			ui.entrar.textContent = 'Estilo';
			ui.entrar.setAttribute( 'aria-label', 'Estilo' );
			ui.entrar.title = 'Colores, tamaños y secciones ocultas. Solo lo ven los desarrolladores.';
			var antesDe = barraEditor.querySelector( '.retoque-boton--faltas' ) || null;
			barraEditor.insertBefore( ui.entrar, antesDe );
		}

		ui.barra = crear( 'div', 'retoque-estilo-barra' );
		ui.barra.setAttribute( 'role', 'toolbar' );
		ui.barra.setAttribute( 'aria-label', 'Modo estilo' );
		ui.barra.hidden = true;
		ui.titulo = crear( 'strong', 'retoque-estilo-barra__titulo', 'Estilo' );
		ui.estado = crear( 'span', 'retoque-estilo-barra__estado', 'Toca lo que quieres cambiar' );
		ui.colores = boton( 'retoque-boton retoque-boton--suave', 'Colores del sitio', abrirPanelColores );
		ui.descartar = boton( 'retoque-boton retoque-boton--suave', 'Descartar', descartar );
		ui.guardar = boton( 'retoque-boton retoque-boton--guardar', 'Guardar', guardar );
		ui.salir = boton( 'retoque-boton retoque-boton--icono', '✕', function () { activar( false ); } );
		ui.salir.title = 'Salir del modo estilo';
		ui.salir.setAttribute( 'aria-label', 'Salir del modo estilo' );
		[ ui.titulo, ui.estado, ui.colores, ui.descartar, ui.guardar, ui.salir ].forEach( function ( n ) { ui.barra.appendChild( n ); } );
		document.body.appendChild( ui.barra );
	}

	function actualizarBarra() {
		var n = cantidadCambios();
		ui.descartar.hidden = n === 0;
		ui.guardar.disabled = n === 0 || estado.guardando;
		ui.guardar.textContent = estado.guardando ? 'Guardando…' : ( n ? 'Guardar (' + n + ')' : 'Guardar' );
		ui.estado.textContent = n ? 'Hay cambios sin guardar' : 'Toca lo que quieres cambiar';
	}

	function activar( encender ) {
		if ( encender === estado.activo ) { return; }
		if ( ! encender && cantidadCambios() > 0 ) {
			if ( ! window.confirm( 'Tienes cambios de estilo sin guardar. ¿Salir y descartarlos?' ) ) { return; }
			descartar();
		}
		estado.activo = encender;
		sesion( encender );
		document.body.classList.toggle( 'retoque-estilando', encender );
		ui.barra.hidden = ! encender;
		cerrarPanel();
		quitarMarca( 'retoque-estilo-encima' );
		pintarCss();
		actualizarBarra();
	}

	function quitarMarca( clase ) {
		Array.prototype.forEach.call( document.querySelectorAll( '.' + clase ), function ( n ) { n.classList.remove( clase ); } );
	}

	function cerrarPanel() {
		if ( ui.panel ) { ui.panel.remove(); ui.panel = null; }
		quitarMarca( 'retoque-estilo-elegido' );
		estado.panel = null;
	}

	function nuevoPanel( titulo ) {
		if ( ui.panel ) { ui.panel.remove(); }
		ui.panel = crear( 'div', 'retoque-estilo-panel' );
		ui.panel.setAttribute( 'role', 'dialog' );
		ui.panel.setAttribute( 'aria-label', titulo );
		var cabeza = crear( 'div', 'retoque-estilo-panel__cabeza' );
		cabeza.appendChild( crear( 'strong', 'retoque-estilo-panel__titulo', titulo ) );
		ui.panelAcciones = crear( 'div', 'retoque-estilo-panel__acciones' );
		ui.panelAcciones.appendChild( boton( 'retoque-estilo-mini', '✕', cerrarPanel ) );
		cabeza.appendChild( ui.panelAcciones );
		ui.panel.appendChild( cabeza );
		document.body.appendChild( ui.panel );
		return ui.panel;
	}

	function grupo( panel, etiqueta ) {
		var g = crear( 'div', 'retoque-estilo-grupo' );
		g.appendChild( crear( 'span', 'retoque-estilo-grupo__etiqueta', etiqueta ) );
		panel.appendChild( g );
		return g;
	}

	function segmentos( contenedor, opciones, actual, alElegir ) {
		var caja = crear( 'div', 'retoque-estilo-segmentos' );
		opciones.forEach( function ( o ) {
			var b = boton( 'retoque-estilo-segmento', o.texto, function () { alElegir( o.valor ); } );
			b.setAttribute( 'aria-pressed', o.valor === actual ? 'true' : 'false' );
			caja.appendChild( b );
		} );
		contenedor.appendChild( caja );
	}

	/* Panel de un elemento */

	function abrirPanelElemento( el, conservar ) {
		var anterior = estado.panel;
		quitarMarca( 'retoque-estilo-elegido' );
		el.classList.add( 'retoque-estilo-elegido' );

		var unico = selectorUnico( el );
		var iguales = selectorIguales( el );
		estado.panel = conservar && anterior && anterior.el === el ? anterior : {
			el: el,
			unico: unico,
			iguales: iguales,
			modo: 'este',
			sitio: esDeTodoElSitio( el ) || ! datos.vista,
			celularManual: false
		};
		// Si el elemento ya tiene estilos guardados, el panel abre en esa regla.
		if ( ! conservar ) {
			var vista = datos.vista || '';
			var buscar = [ [ 'este', false, unico ], [ 'este', true, unico ], [ 'iguales', false, iguales ], [ 'iguales', true, iguales ] ];
			for ( var i = 0; i < buscar.length; i++ ) {
				if ( ! buscar[ i ][2] ) { continue; }
				var clave = ( buscar[ i ][1] || ! vista ? '' : vista ) + '|' + buscar[ i ][2];
				if ( estado.reglas[ clave ] ) {
					estado.panel.modo = buscar[ i ][0];
					estado.panel.sitio = buscar[ i ][1] || ! vista;
					break;
				}
			}
		}

		var p = estado.panel;
		var panel = nuevoPanel( nombreDe( el ) );
		if ( el.parentElement && el.parentElement !== document.body ) {
			var subir = boton( 'retoque-estilo-mini', '↑ Contenedor', function () { abrirPanelElemento( el.parentElement ); } );
			subir.title = 'Elige el bloque que contiene a este (por ejemplo, la sección completa)';
			ui.panelAcciones.insertBefore( subir, ui.panelAcciones.firstChild );
		}

		if ( p.iguales ) {
			segmentos( grupo( panel, 'Aplicar a' ), [
				{ valor: 'este', texto: 'Este elemento' },
				{ valor: 'iguales', texto: 'Todos los iguales (' + contar( p.iguales ) + ')' }
			], p.modo, function ( v ) { moverRegla( function () { p.modo = v; } ); } );
		}
		if ( datos.vista ) {
			segmentos( grupo( panel, 'Dónde' ), [
				{ valor: false, texto: 'Solo esta página' },
				{ valor: true, texto: 'Todo el sitio' }
			], p.sitio, function ( v ) { moverRegla( function () { p.sitio = v; } ); } );
		}

		var regla = reglaActual() || {};
		var estilo = window.getComputedStyle( el );
		var ahora = Math.round( parseFloat( estilo.fontSize ) ) || 16;

		// Tamaño del texto
		var gTamano = grupo( panel, 'Tamaño del texto' );
		var campoPc = filaTamano( gTamano, 'PC', regla.tamano_pc, esCelular() ? 0 : ahora, function ( v ) {
			cambiar( 'tamano_pc', v );
			// En celular, un título grande se achica solo. Si se cambia a mano, se respeta.
			if ( ! p.celularManual && ! esCelular() ) {
				var celular = v >= 24 ? Math.round( v * 0.8 ) : 0;
				campoCelular.value = celular || '';
				cambiar( 'tamano_celular', celular );
			}
		} );
		var campoCelular = filaTamano( gTamano, 'Celular', regla.tamano_celular, esCelular() ? ahora : 0, function ( v ) {
			p.celularManual = true;
			cambiar( 'tamano_celular', v );
		} );
		void campoPc;
		gTamano.appendChild( crear( 'small', 'retoque-estilo-ayuda', 'En celular se ajusta solo al cambiar el de PC. Para revisarlo, achica la ventana.' ) );

		// Colores
		filaColor( grupo( panel, 'Color del texto' ), regla.color, aHex( estilo.color ) || '#000000', function ( v ) { cambiar( 'color', v ); } );
		filaColor( grupo( panel, 'Color de fondo' ), regla.fondo, aHex( estilo.backgroundColor ) || '#ffffff', function ( v ) { cambiar( 'fondo', v ); } );

		// Ocultar
		var gOcultar = grupo( panel, 'Mostrar' );
		var selector = crear( 'select', 'retoque-estilo-select' );
		[ [ '', 'Se ve en todo' ], [ 'todo', 'Ocultar en todo' ], [ 'celular', 'Ocultar solo en celular' ], [ 'pc', 'Ocultar solo en PC' ] ].forEach( function ( o ) {
			var opcion = crear( 'option', '', o[1] );
			opcion.value = o[0];
			selector.appendChild( opcion );
		} );
		selector.value = regla.ocultar || '';
		selector.addEventListener( 'change', function () { cambiar( 'ocultar', selector.value ); } );
		gOcultar.appendChild( selector );
		gOcultar.appendChild( crear( 'small', 'retoque-estilo-ayuda', 'Lo oculto se ve tenue y rayado solo mientras estás en Estilo, para que puedas volver a mostrarlo.' ) );

		var pie = crear( 'div', 'retoque-estilo-panel__pie' );
		pie.appendChild( boton( 'retoque-estilo-mini', 'Quitar los cambios de este elemento', function () {
			delete estado.reglas[ claveActual().clave ];
			pintarCss();
			actualizarBarra();
			abrirPanelElemento( el, true );
		} ) );
		pie.appendChild( boton( 'retoque-boton retoque-boton--principal', 'Listo', cerrarPanel ) );
		panel.appendChild( pie );

		// En celular el panel tapa la mitad de abajo: el elemento sube para verlo mientras cambia.
		if ( ! conservar && esCelular() ) {
			window.scrollTo( { top: Math.max( 0, el.getBoundingClientRect().top + window.pageYOffset - 70 ), behavior: 'smooth' } );
		}
	}

	function filaTamano( contenedor, etiqueta, valor, ahora, alCambiar ) {
		var fila = crear( 'div', 'retoque-estilo-fila' );
		fila.appendChild( crear( 'span', 'retoque-estilo-fila__nombre', etiqueta ) );
		var campo = crear( 'input', 'retoque-estilo-numero' );
		campo.type = 'number';
		campo.min = '8';
		campo.max = '200';
		campo.inputMode = 'numeric';
		campo.value = valor || '';
		campo.placeholder = ahora ? String( ahora ) : '—';
		campo.setAttribute( 'aria-label', 'Tamaño del texto en ' + etiqueta + ', en píxeles' );
		var leer = function () {
			var n = parseInt( campo.value, 10 );
			return n >= 8 && n <= 200 ? n : 0;
		};
		var paso = function ( delta ) {
			var base = leer() || parseInt( campo.placeholder, 10 ) || 16;
			campo.value = Math.max( 8, Math.min( 200, base + delta ) );
			alCambiar( leer() );
		};
		campo.addEventListener( 'input', function () { alCambiar( leer() ); } );
		fila.appendChild( boton( 'retoque-estilo-mini', '−', function () { paso( -2 ); } ) );
		fila.appendChild( campo );
		fila.appendChild( crear( 'span', 'retoque-estilo-fila__unidad', 'px' ) );
		fila.appendChild( boton( 'retoque-estilo-mini', '+', function () { paso( 2 ); } ) );
		if ( ahora ) { fila.appendChild( crear( 'small', 'retoque-estilo-ayuda', 'ahora ' + ahora ) ); }
		contenedor.appendChild( fila );
		return campo;
	}

	function filaColor( contenedor, valor, actual, alCambiar ) {
		var fila = crear( 'div', 'retoque-estilo-fila' );
		var campo = crear( 'input', 'retoque-estilo-color' );
		campo.type = 'color';
		campo.value = valor || actual;
		var estadoTexto = crear( 'span', 'retoque-estilo-ayuda', valor ? valor : 'el del diseño' );
		var quitar = boton( 'retoque-estilo-mini', 'Quitar', function () {
			campo.value = actual;
			estadoTexto.textContent = 'el del diseño';
			quitar.hidden = true;
			alCambiar( '' );
		} );
		quitar.hidden = ! valor;
		campo.addEventListener( 'input', function () {
			estadoTexto.textContent = campo.value;
			quitar.hidden = false;
			alCambiar( campo.value );
		} );
		fila.appendChild( campo );
		fila.appendChild( estadoTexto );
		fila.appendChild( quitar );
		contenedor.appendChild( fila );
	}

	/* Panel de colores del sitio */

	function variablesDeColor() {
		var encontradas = {};
		Array.prototype.forEach.call( document.styleSheets, function ( hoja ) {
			var nodo = hoja.ownerNode;
			if ( nodo && ( nodo.id === 'retoque-estilos' || nodo.id === 'retoque-estilos-vivo' ) ) { return; }
			var reglas;
			try { reglas = hoja.cssRules; } catch ( e ) { return; } // Hojas de otro dominio (fuentes, etc.).
			Array.prototype.forEach.call( reglas || [], function ( regla ) {
				if ( regla.selectorText !== ':root' || ! regla.style ) { return; }
				for ( var i = 0; i < regla.style.length; i++ ) {
					var nombre = regla.style[ i ];
					if ( nombre.indexOf( '--' ) !== 0 || nombre.indexOf( '--retoque' ) === 0 || nombre.indexOf( '--wp' ) === 0 ) { continue; }
					var color = aHex( regla.style.getPropertyValue( nombre ) );
					if ( color ) { encontradas[ nombre ] = color; }
				}
			} );
		} );
		return encontradas;
	}

	function nombreVariable( variable ) {
		var texto = variable.replace( /^--/, '' ).replace( /[-_]+/g, ' ' );
		return texto.charAt( 0 ).toUpperCase() + texto.slice( 1 );
	}

	function abrirPanelColores() {
		cerrarPanel();
		estado.originales = variablesDeColor();
		var panel = nuevoPanel( 'Colores del sitio' );
		var variables = Object.keys( estado.originales );
		Object.keys( estado.colores ).forEach( function ( v ) { if ( variables.indexOf( v ) < 0 ) { variables.push( v ); } } );
		if ( ! variables.length ) {
			panel.appendChild( crear( 'p', 'retoque-estilo-ayuda', 'Este tema no define sus colores como variables en :root, así que no hay colores generales para cambiar. Puedes cambiar el color de cada elemento tocándolo.' ) );
			return;
		}
		panel.appendChild( crear( 'p', 'retoque-estilo-ayuda', 'Cambian en todo el sitio: botones, fondos y textos que usan ese color.' ) );
		var lista = crear( 'div', 'retoque-estilo-colores' );
		variables.forEach( function ( variable ) {
			var original = estado.originales[ variable ] || '#000000';
			var fila = crear( 'label', 'retoque-estilo-fila retoque-estilo-fila--color' );
			var campo = crear( 'input', 'retoque-estilo-color' );
			campo.type = 'color';
			campo.value = estado.colores[ variable ] || original;
			var nombre = crear( 'span', 'retoque-estilo-fila__nombre', nombreVariable( variable ) );
			nombre.title = variable;
			var volver = boton( 'retoque-estilo-mini', 'Original', function () {
				delete estado.colores[ variable ];
				campo.value = original;
				volver.hidden = true;
				pintarCss();
				actualizarBarra();
			} );
			volver.hidden = ! estado.colores[ variable ];
			campo.addEventListener( 'input', function () {
				if ( campo.value === original ) {
					delete estado.colores[ variable ];
				} else {
					estado.colores[ variable ] = campo.value;
				}
				volver.hidden = ! estado.colores[ variable ];
				pintarCss();
				actualizarBarra();
			} );
			fila.appendChild( campo );
			fila.appendChild( nombre );
			fila.appendChild( volver );
			lista.appendChild( fila );
		} );
		panel.appendChild( lista );
	}

	/* ------------------------------------------------------------------
	 * Guardar y descartar
	 * ---------------------------------------------------------------- */

	function descartar() {
		var antes = JSON.parse( estado.guardado );
		estado.colores = antes.colores;
		estado.reglas = antes.reglas;
		var abierto = estado.panel && estado.panel.el;
		var colores = ui.panel && ! abierto;
		pintarCss();
		actualizarBarra();
		if ( abierto ) { abrirPanelElemento( abierto ); } else if ( colores ) { abrirPanelColores(); }
	}

	function guardar() {
		if ( estado.guardando || ! cantidadCambios() ) { return; }
		estado.guardando = true;
		actualizarBarra();
		window.fetch( datos.api, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': datos.nonce },
			body: JSON.stringify( {
				colores: estado.colores,
				reglas: Object.keys( estado.reglas ).map( function ( k ) { return estado.reglas[ k ]; } )
			} )
		} ).then( function ( respuesta ) {
			return respuesta.json().catch( function () { return {}; } ).then( function ( cuerpo ) {
				if ( ! respuesta.ok ) {
					var mensaje = cuerpo.message || 'El servidor respondió con un error (' + respuesta.status + ').';
					if ( /nonce|cookie/i.test( mensaje ) ) { mensaje = 'Tu sesión expiró. Recarga la página e inténtalo de nuevo.'; }
					throw new Error( mensaje );
				}
				return cuerpo;
			} );
		} ).then( function ( cuerpo ) {
			if ( cuerpo.estilos ) {
				estado.colores = objeto( cuerpo.estilos.colores );
				estado.reglas = objeto( cuerpo.estilos.reglas );
			}
			estado.guardado = foto();
			pintarCss();
			aviso( 'Estilo guardado. Los visitantes ya lo ven.' );
		} ).catch( function ( error ) {
			aviso( 'No se guardó el estilo: ' + error.message, 'error' );
		} ).then( function () {
			estado.guardando = false;
			actualizarBarra();
		} );
	}

	/* ------------------------------------------------------------------
	 * Eventos
	 * ---------------------------------------------------------------- */

	function alHacerClic( e ) {
		if ( ! estado.activo ) { return; }
		var objetivo = e.target;
		// «Editar en vivo» de la barra negra: primero se sale del modo estilo.
		if ( objetivo.closest && objetivo.closest( '#wp-admin-bar-retoque-editar' ) ) {
			activar( false );
			if ( estado.activo ) { e.preventDefault(); e.stopPropagation(); }
			return;
		}
		if ( dentroDeInterfaz( objetivo ) || objetivo === document.body || objetivo === document.documentElement ) { return; }
		// En este modo no se navega ni se abren menús: el clic solo elige.
		e.preventDefault();
		e.stopPropagation();
		// Tocar el texto o el ícono de un botón elige el botón completo.
		var botonPadre = objetivo.closest( 'a, button' );
		if ( botonPadre && botonPadre !== objetivo && ! dentroDeInterfaz( botonPadre ) ) { objetivo = botonPadre; }
		abrirPanelElemento( objetivo );
	}

	function alPasarEncima( e ) {
		if ( ! estado.activo ) { return; }
		quitarMarca( 'retoque-estilo-encima' );
		var objetivo = e.target;
		if ( ! dentroDeInterfaz( objetivo ) && objetivo !== document.body && objetivo !== document.documentElement ) {
			objetivo.classList.add( 'retoque-estilo-encima' );
		}
	}

	function iniciar() {
		construir();
		pintarCss();
		window.addEventListener( 'click', alHacerClic, true );
		window.addEventListener( 'submit', function ( e ) {
			if ( estado.activo && ! dentroDeInterfaz( e.target ) ) { e.preventDefault(); e.stopPropagation(); }
		}, true );
		document.addEventListener( 'mouseover', alPasarEncima );
		document.addEventListener( 'keydown', function ( e ) {
			if ( estado.activo && e.key === 'Escape' && ui.panel ) { cerrarPanel(); }
		} );
		window.addEventListener( 'beforeunload', function ( e ) {
			if ( estado.activo && cantidadCambios() > 0 ) { e.preventDefault(); e.returnValue = ''; }
		} );
		if ( sesion() ) { activar( true ); }
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', iniciar );
	} else {
		iniciar();
	}
}() );

}
