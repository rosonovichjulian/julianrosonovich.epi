// Acceso a "Recursos gratis".
// - Quien deja su email en /recursos/ queda desbloqueado en ese navegador.
// - Los links que mandás por mensaje llevan ?acceso=CODIGO y desbloquean directo.
//   Ej.: https://julianrosonovich-epi.vercel.app/pico/?acceso=investigacion
// Para cambiar el código, editá CODIGOS (podés tener varios a la vez).
(function () {
  var CODIGOS = ['investigacion'];
  var KEY = 'jr-recursos-v1';

  function leer() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return { bloqueado: false, sinStorage: true }; } }
  function guardar(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var params = new URLSearchParams(location.search);
  var codigo = (params.get('acceso') || '').toLowerCase().trim();
  if (codigo && CODIGOS.indexOf(codigo) !== -1) {
    guardar({ desbloqueado: true, via: 'link', en: new Date().toISOString() });
    params.delete('acceso');
    var q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }

  var estado = leer();
  window.JR_ACCESO = {
    // Si el navegador no permite guardar datos (modo privado estricto), no bloqueamos a nadie.
    desbloqueado: function () { var s = leer(); return !!(s && (s.desbloqueado || s.sinStorage)); },
    desbloquear: function (via) { guardar({ desbloqueado: true, via: via || 'email', en: new Date().toISOString() }); },
    // Llamar desde la página de un recurso: si no está desbloqueado, manda al formulario.
    proteger: function (recurso) {
      if (!this.desbloqueado()) location.replace('/recursos/?r=' + encodeURIComponent(recurso) + '#desbloquear');
    }
  };
})();
