/* ============================================================
   GPS com voz – geolocalização, busca de endereço (Nominatim),
   rota a pé (FOSSGIS/OSRM) e instruções faladas em português
   ============================================================ */
(function () {
  'use strict';
  const { $ } = App;

  const statusEl = $('#gps-status');
  const instrEl = $('#gps-instruction');
  const destInput = $('#gps-dest');
  const btnRepeat = $('#gps-repeat');
  const btnStop = $('#gps-stop');
  const btnSim = $('#gps-sim');

  let map = null, userMarker = null, destMarker = null, routeLine = null;
  let watchId = null;
  let positionRequest = null;
  let pos = null;            // {lat, lon, acc, updatedAt}
  let dest = null;           // {lat, lon, name}
  let route = null;
  let steps = [];
  let idx = 1;               // próxima manobra a executar
  let navigating = false;
  let nearWarned = {};
  let lastRecalc = 0;
  let simTimer = null;
  let simulating = false;

  /* ---------- geometria ---------- */
  const rad = d => (d * Math.PI) / 180;
  function dist(a, b) {
    const R = 6371000;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // distância de um ponto a um segmento (metros, aproximação plana local)
  function distToSegment(p, a, b) {
    const kx = 111320 * Math.cos(rad(p.lat)), ky = 110540;
    const ax = (a[0] - p.lon) * kx, ay = (a[1] - p.lat) * ky;
    const bx = (b[0] - p.lon) * kx, by = (b[1] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  function distToRoute(p) {
    if (!route) return 0;
    const c = route.geometry.coordinates;
    let best = Infinity;
    for (let i = 0; i < c.length - 1; i++) best = Math.min(best, distToSegment(p, c[i], c[i + 1]));
    return best;
  }
  // gera pontos a cada "stepM" metros ao longo da rota (para a simulação)
  function densify(coords, stepM) {
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = { lat: coords[i][1], lon: coords[i][0] };
      const b = { lat: coords[i + 1][1], lon: coords[i + 1][0] };
      const d = dist(a, b);
      const n = Math.max(1, Math.floor(d / stepM));
      for (let k = 0; k < n; k++) {
        out.push([a.lon + ((b.lon - a.lon) * k) / n, a.lat + ((b.lat - a.lat) * k) / n]);
      }
    }
    out.push(coords[coords.length - 1]);
    return out;
  }

  /* ---------- textos em português ---------- */
  function distText(m) {
    if (m < 15) return 'poucos metros';
    if (m < 1000) return Math.round(m / 10) * 10 + ' metros';
    return (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' quilômetros';
  }
  function prep(name) {
    if (!name) return '';
    if (/^(rua|avenida|alameda|travessa|pra[çc]a|estrada|rodovia|ladeira|via|vila|marginal|passarela|ciclovia|passagem)\b/i.test(name)) return 'na ' + name;
    if (/^(largo|viaduto|beco|parque|jardim|caminho|t[úu]nel|boulevard|corredor|elevado|calçad[aã]o)\b/i.test(name)) return 'no ' + name;
    return 'em ' + name;
  }
  const MOD = {
    'left': 'à esquerda', 'right': 'à direita',
    'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita',
    'sharp left': 'acentuadamente à esquerda', 'sharp right': 'acentuadamente à direita'
  };
  function stepText(s) {
    const m = s.maneuver || {};
    const mod = MOD[m.modifier];
    const where = s.name ? ' ' + prep(s.name) : '';
    switch (m.type) {
      case 'depart': return 'Comece a caminhar' + where;
      case 'arrive':
        if (m.modifier === 'left') return 'Você chegou ao destino. Ele está à sua esquerda';
        if (m.modifier === 'right') return 'Você chegou ao destino. Ele está à sua direita';
        return 'Você chegou ao seu destino';
      case 'roundabout':
      case 'rotary':
      case 'roundabout turn':
        return m.exit ? `Na rotatória, pegue a ${m.exit}ª saída${where}` : 'Entre na rotatória';
      case 'fork':
        return mod ? `Na bifurcação, mantenha-se ${mod}${where}` : 'Na bifurcação, siga em frente';
      case 'end of road':
        return mod ? `No fim da via, vire ${mod}${where}` : 'No fim da via, siga a orientação';
      default:
        if (m.modifier === 'uturn') return 'Faça o retorno';
        if (mod) return `Vire ${mod}${where}`;
        return 'Siga em frente' + where;
    }
  }

  // Junta manobras "siga em frente" sem importância na anterior.
  function simplify(list) {
    const out = [];
    list.forEach((s, i) => {
      const t = s.maneuver.type, mod = s.maneuver.modifier;
      const trivial = (t === 'new name' || t === 'continue' || t === 'notification') && (!mod || mod === 'straight');
      if (trivial && out.length && i !== list.length - 1) out[out.length - 1].distance += s.distance;
      else out.push(Object.assign({}, s));
    });
    return out;
  }

  /* ---------- mapa ---------- */
  function initMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('gps-map').setView([-14.235, -51.925], 4);
    // Usamos o espelho de tiles do CARTO (dados do OpenStreetMap) em vez do
    // tile.openstreetmap.org direto: o servidor oficial da OSM bloqueia por
    // política de uso quando detecta apps/testes repetidos (erro "Access blocked").
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd',
      attribution: '© OpenStreetMap contributors © CARTO'
    }).addTo(map);
    if (pos) updateMap(true);
  }
  function updateMap(recenter) {
    if (!map || !pos) return;
    const ll = [pos.lat, pos.lon];
    if (!userMarker) userMarker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#1f4fa3', fillOpacity: 1 }).addTo(map);
    else userMarker.setLatLng(ll);
    if (recenter || navigating) map.setView(ll, Math.max(map.getZoom(), 17));
  }

  /* ---------- localização ---------- */
  function onPos(p) {
    pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 20, updatedAt: Date.now() };
    statusEl.textContent = `Localização ativa · precisão de cerca de ${Math.round(pos.acc)} m${simulating ? ' (simulação)' : ''}`;
    updateMap(false);
    if (navigating) progress();
  }
  function onGeoError(err) {
    const msg = err && err.code === 1
      ? 'Permissão de localização negada. Para tentar novamente, abra as permissões do site pelo ícone ao lado do endereço do navegador, permita a localização e depois pressione o botão novamente.'
      : err && err.code === 3
        ? 'A localização demorou demais. Verifique se a localização está ativada no aparelho e tente novamente.'
        : 'Não consegui obter sua localização. Verifique as configurações de localização e tente novamente em um local aberto.';
    statusEl.textContent = msg;
    App.speak(msg);
  }
  function stopWatch() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  function startWatch() {
    if (watchId !== null) return;
    if (!navigator.geolocation) { statusEl.textContent = 'Este navegador não tem geolocalização.'; return; }
    // Só inicia o acompanhamento depois de uma ação explícita do usuário e de
    // uma localização inicial bem-sucedida; evita pedidos concorrentes de permissão.
    watchId = navigator.geolocation.watchPosition(
      p => { if (!simulating) onPos(p); },
      err => {
        stopWatch();
        if (!simulating) onGeoError(err);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }
  function getPos() {
    if (pos && !simulating && Date.now() - pos.updatedAt < 10000) return Promise.resolve(pos);
    if (positionRequest) return positionRequest;
    if (!navigator.geolocation) return Promise.reject(new Error('Este navegador não oferece geolocalização.'));

    statusEl.textContent = 'Solicitando sua localização ao navegador…';
    positionRequest = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        p => { onPos(p); resolve(pos); },
        err => { onGeoError(err); reject(err); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    }).finally(() => { positionRequest = null; });
    return positionRequest;
  }

  /* ---------- serviços externos ---------- */
  async function reverse() {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${pos.lat}&lon=${pos.lon}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Falha na busca do endereço.');
    return r.json();
  }
  async function geocode(q) {
    let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
    if (pos) {
      const d = 0.3;
      url += `&viewbox=${pos.lon - d},${pos.lat + d},${pos.lon + d},${pos.lat - d}`;
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error('Falha na busca do destino.');
    const j = await r.json();
    if (!j.length) return null;
    return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), name: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
  }
  async function fetchRoute(from, to) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('O serviço de rotas não respondeu.');
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('Não encontrei um caminho a pé até esse destino.');
    return j.routes[0];
  }

  /* ---------- navegação ---------- */
  function setControls(on) {
    btnRepeat.disabled = !on;
    btnStop.disabled = !on;
    btnSim.disabled = !route;
  }

  function showInstruction() {
    const s = steps[idx];
    if (!s || !pos) return;
    const d = dist(pos, { lat: s.maneuver.location[1], lon: s.maneuver.location[0] });
    instrEl.textContent = `Em ${distText(d)}: ${stepText(s)}`;
  }

  function drawRoute() {
    if (!map) initMap();
    if (!map) return;
    if (routeLine) map.removeLayer(routeLine);
    if (destMarker) map.removeLayer(destMarker);
    routeLine = L.polyline(route.geometry.coordinates.map(c => [c[1], c[0]]), { color: '#d62828', weight: 6 }).addTo(map);
    destMarker = L.circleMarker([dest.lat, dest.lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#d62828', fillOpacity: 1 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  }

  function startRoute(rt, quiet) {
    route = rt;
    steps = simplify(rt.legs[0].steps);
    idx = steps.length > 1 ? 1 : 0;
    nearWarned = {};
    navigating = true;
    setControls(true);
    startWatch();
    drawRoute();
    const minutes = Math.max(1, Math.round(rt.duration / 60));
    let text = quiet ? '' :
      `Rota a pé calculada até ${dest.name}. São ${distText(rt.distance)}, cerca de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}. `;
    text += stepText(steps[0]) + '.';
    if (steps[1] && steps[0].distance > 15) text += ` Depois de ${distText(steps[0].distance)}, ${App.lc(stepText(steps[1]))}.`;
    instrEl.textContent = stepText(steps[0]);
    App.speak(text);
  }

  async function goTo(text) {
    text = (text || '').trim();
    if (!text) { App.speak('Digite ou diga o destino.'); return; }
    destInput.value = text;
    try {
      App.speak('Procurando o destino.');
      await getPos();
      const d = await geocode(text);
      if (!d) { App.speak('Não encontrei esse destino. Tente incluir a cidade ou o bairro.'); return; }
      dest = d;
      const rt = await fetchRoute(pos, dest);
      startRoute(rt);
    } catch (e) {
      console.error(e);
      if (e && (e.code === 1 || e.code === 2 || e.code === 3)) return; // já avisado
      App.speak('Não foi possível calcular a rota. ' + (e.message || 'Verifique a internet.'));
    }
  }

  function progress() {
    if (!navigating || !pos) return;
    let guard = 0;
    while (guard++ < 3) {
      const s = steps[idx];
      if (!s) return;
      const last = idx === steps.length - 1;
      const target = { lat: s.maneuver.location[1], lon: s.maneuver.location[0] };
      const d = dist(pos, target);
      const trigger = Math.max(15, Math.min(30, pos.acc * 0.8));

      // saiu da rota?
      if (!last || d > trigger) {
        const off = distToRoute(pos);
        if (off > Math.max(40, pos.acc * 1.5) && Date.now() - lastRecalc > 15000) { recalc(); return; }
      }

      // pulou uma manobra (cortou caminho)?
      const nxt = steps[idx + 1];
      if (nxt && dist(pos, { lat: nxt.maneuver.location[1], lon: nxt.maneuver.location[0] }) <= trigger && d > trigger) { idx++; continue; }

      if (d <= trigger) {
        const text = stepText(s);
        if (last) { App.speak(text + '.'); finish(); return; }
        App.speak(s.distance > 15 ? `${text}. Siga por ${distText(s.distance)}.` : `${text}.`);
        idx++;
        showInstruction();
        return;
      }
      if (d <= 60 && !nearWarned[idx]) {
        nearWarned[idx] = true;
        App.speak(last ? `Você está chegando ao destino, a ${distText(d)}.` : `Em ${distText(d)}, ${App.lc(stepText(s))}.`);
      }
      showInstruction();
      return;
    }
  }

  async function recalc() {
    lastRecalc = Date.now();
    App.speak('Você saiu da rota. Recalculando.');
    try {
      const rt = await fetchRoute(pos, dest);
      startRoute(rt, true);
    } catch (e) {
      App.speak('Não consegui recalcular a rota agora.');
    }
  }

  function finish() {
    navigating = false;
    stopWatch();
    stopSim();
    instrEl.textContent = 'Você chegou ao destino.';
    btnRepeat.disabled = true;
    btnStop.disabled = true;
  }

  function stop(silent) {
    const was = navigating;
    navigating = false;
    stopWatch();
    stopSim();
    if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
    if (destMarker && map) { map.removeLayer(destMarker); destMarker = null; }
    route = null; steps = [];
    instrEl.textContent = 'Nenhuma navegação ativa.';
    setControls(false);
    if (!silent) App.speak(was ? 'Navegação encerrada.' : 'Não há navegação ativa.');
  }

  function repeat() {
    if (!navigating || !steps[idx] || !pos) { App.speak('Não há navegação ativa.'); return; }
    const d = dist(pos, { lat: steps[idx].maneuver.location[1], lon: steps[idx].maneuver.location[0] });
    App.speak(`Em ${distText(d)}, ${App.lc(stepText(steps[idx]))}.`);
  }

  /* ---------- simulação (para testar sem sair do lugar) ---------- */
  function stopSim() {
    clearInterval(simTimer);
    simTimer = null;
    if (simulating) { simulating = false; btnSim.textContent = '🧪 Simular caminhada (teste)'; }
  }
  function simulate() {
    if (!route) { App.speak('Calcule uma rota primeiro.'); return; }
    if (simulating) { stopSim(); App.speak('Simulação encerrada.'); return; }
    const pts = densify(route.geometry.coordinates, 10);
    let i = 0;
    simulating = true;
    btnSim.textContent = '⏹ Parar simulação';
    App.speak('Simulação de caminhada iniciada.', { interrupt: false });
    simTimer = setInterval(() => {
      if (i >= pts.length) { stopSim(); return; }
      const [lon, lat] = pts[i++];
      onPos({ coords: { latitude: lat, longitude: lon, accuracy: 5 } });
    }, 1100);
  }

  /* ---------- ações dos botões ---------- */
  async function whereAmI() {
    try {
      await getPos();
      App.speak('Consultando o endereço.');
      const j = await reverse();
      const a = j.address || {};
      const road = a.road || a.pedestrian || a.footway || a.path || '';
      const parts = [];
      if (road) parts.push(road + (a.house_number ? ', número ' + a.house_number : ''));
      const bairro = a.suburb || a.neighbourhood || a.quarter || a.city_district;
      if (bairro) parts.push('bairro ' + bairro);
      const cidade = a.city || a.town || a.village || a.municipality;
      if (cidade) parts.push(cidade);
      if (a.state) parts.push(a.state);
      App.speak(parts.length ? 'Você está em ' + parts.join(', ') + '.' : 'Você está em ' + (j.display_name || 'um local não identificado') + '.');
    } catch (e) {
      if (e && e.code) return;
      App.speak('Não consegui descobrir o endereço agora. Verifique a internet.');
    }
  }

  async function share() {
    try { await getPos(); } catch (e) { return; }
    const url = `https://www.google.com/maps?q=${pos.lat},${pos.lon}`;
    const text = `Estou aqui: ${url}`;
    if (navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); } catch (e) { /* ignora */ }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    App.speak('Localização pronta para enviar. Escolha o contato no WhatsApp. O link também foi copiado.');
  }

  $('#gps-where').addEventListener('click', whereAmI);
  $('#gps-share').addEventListener('click', share);
  $('#gps-go').addEventListener('click', () => goTo(destInput.value));
  destInput.addEventListener('keydown', e => { if (e.key === 'Enter') goTo(destInput.value); });
  $('#gps-mic').addEventListener('click', () => App.dictate(t => goTo(t), 'Diga o destino.'));
  btnRepeat.addEventListener('click', repeat);
  btnStop.addEventListener('click', () => stop(false));
  btnSim.addEventListener('click', simulate);

  document.addEventListener('tabchange', e => {
    if (e.detail !== 'gps') return;
    initMap();
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
    // Não pedir localização apenas ao abrir a aba. A permissão é solicitada
    // quando a pessoa escolhe uma ação como 'Onde estou?' ou calcula uma rota.
  });

  App.gps = { goTo, stop, repeat, whereAmI, share };
})();
