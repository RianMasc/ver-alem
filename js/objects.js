/* ============================================================
   Reconhecimento de objetos – TensorFlow.js + COCO-SSD + voz
   ============================================================ */
(function () {
  'use strict';
  const { $ } = App;

  const video = $('#obj-video');
  const canvas = $('#obj-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = $('#obj-placeholder');
  const btnStart = $('#obj-start');
  const btnDescribe = $('#obj-describe');
  const autoBox = $('#obj-auto');
  const statusEl = $('#obj-status');
  const listEl = $('#obj-list');

  const PT = {
    'person': 'pessoa', 'bicycle': 'bicicleta', 'car': 'carro', 'motorcycle': 'moto', 'airplane': 'avião',
    'bus': 'ônibus', 'train': 'trem', 'truck': 'caminhão', 'boat': 'barco', 'traffic light': 'semáforo',
    'fire hydrant': 'hidrante', 'stop sign': 'placa de pare', 'parking meter': 'parquímetro', 'bench': 'banco',
    'bird': 'pássaro', 'cat': 'gato', 'dog': 'cachorro', 'horse': 'cavalo', 'sheep': 'ovelha', 'cow': 'vaca',
    'elephant': 'elefante', 'bear': 'urso', 'zebra': 'zebra', 'giraffe': 'girafa', 'backpack': 'mochila',
    'umbrella': 'guarda-chuva', 'handbag': 'bolsa', 'tie': 'gravata', 'suitcase': 'mala', 'frisbee': 'frisbee',
    'skis': 'esquis', 'snowboard': 'snowboard', 'sports ball': 'bola', 'kite': 'pipa', 'baseball bat': 'taco de beisebol',
    'baseball glove': 'luva de beisebol', 'skateboard': 'skate', 'surfboard': 'prancha de surfe',
    'tennis racket': 'raquete de tênis', 'bottle': 'garrafa', 'wine glass': 'taça', 'cup': 'copo', 'fork': 'garfo',
    'knife': 'faca', 'spoon': 'colher', 'bowl': 'tigela', 'banana': 'banana', 'apple': 'maçã', 'sandwich': 'sanduíche',
    'orange': 'laranja', 'broccoli': 'brócolis', 'carrot': 'cenoura', 'hot dog': 'cachorro-quente', 'pizza': 'pizza',
    'donut': 'rosquinha', 'cake': 'bolo', 'chair': 'cadeira', 'couch': 'sofá', 'potted plant': 'planta em vaso',
    'bed': 'cama', 'dining table': 'mesa', 'toilet': 'vaso sanitário', 'tv': 'televisão', 'laptop': 'notebook',
    'mouse': 'mouse', 'remote': 'controle remoto', 'keyboard': 'teclado', 'cell phone': 'celular',
    'microwave': 'micro-ondas', 'oven': 'forno', 'toaster': 'torradeira', 'sink': 'pia', 'refrigerator': 'geladeira',
    'book': 'livro', 'clock': 'relógio', 'vase': 'vaso', 'scissors': 'tesoura', 'teddy bear': 'urso de pelúcia',
    'hair drier': 'secador de cabelo', 'toothbrush': 'escova de dentes'
  };
  const PLURAL_SPECIAL = {
    'placa de pare': 'placas de pare', 'planta em vaso': 'plantas em vaso', 'controle remoto': 'controles remotos',
    'urso de pelúcia': 'ursos de pelúcia', 'secador de cabelo': 'secadores de cabelo', 'escova de dentes': 'escovas de dentes',
    'taco de beisebol': 'tacos de beisebol', 'luva de beisebol': 'luvas de beisebol', 'prancha de surfe': 'pranchas de surfe',
    'raquete de tênis': 'raquetes de tênis', 'vaso sanitário': 'vasos sanitários', 'cachorro-quente': 'cachorros-quentes',
    'guarda-chuva': 'guarda-chuvas', 'micro-ondas': 'micro-ondas', 'brócolis': 'brócolis', 'ônibus': 'ônibus', 'esquis': 'esquis'
  };
  function plural(w) {
    if (PLURAL_SPECIAL[w]) return PLURAL_SPECIAL[w];
    if (/s$/.test(w)) return w;
    if (/ão$/.test(w)) return w.replace(/ão$/, 'ões');
    if (/m$/.test(w)) return w.replace(/m$/, 'ns');
    if (/[rz]$/.test(w)) return w + 'es';
    return w + 's';
  }
  function listToSentence(arr) {
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
  }

  let model = null;
  let loading = false;
  let running = false;
  let timer = null;
  let lastItems = [];
  const lastSpoken = {};

  const setStatus = t => { statusEl.textContent = t; };

  function resetUi() {
    running = false;
    clearTimeout(timer);
    placeholder.hidden = false;
    btnStart.textContent = 'Ligar câmera e detectar';
    btnDescribe.disabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastItems = [];
    listEl.innerHTML = '<li class="muted">Nenhum objeto detectado.</li>';
  }
  document.addEventListener('tabchange', resetUi);

  async function loadModel() {
    if (model) return model;
    if (typeof cocoSsd === 'undefined') throw new Error('A biblioteca de reconhecimento não foi carregada. Verifique a internet e recarregue a página.');
    if (loading) return null;
    loading = true;
    setStatus('Carregando o modelo de reconhecimento (só na primeira vez)…');
    App.speak('Carregando o reconhecimento de objetos. Aguarde.');
    try {
      model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    } finally {
      loading = false;
    }
    return model;
  }

  async function start() {
    try {
      await App.camera.start(video);
      placeholder.hidden = true;
      btnStart.textContent = 'Desligar câmera';
      const m = await loadModel();
      if (!m || !App.camera.stream) return;
      running = true;
      btnDescribe.disabled = false;
      setStatus('Detectando objetos…');
      App.speak('Pronto. Aponte a câmera ao redor. Diga descrever para ouvir o que estou vendo.');
      loop();
    } catch (e) {
      console.error(e);
      App.camera.stop();
      resetUi();
      const msg = e && e.name === 'NotAllowedError'
        ? 'Permissão da câmera negada. Libere a câmera nas configurações do navegador.'
        : (e && e.message) || 'Não foi possível iniciar o reconhecimento.';
      setStatus(msg);
      App.speak(msg);
    }
  }

  function stop() {
    App.camera.stop();
    resetUi();
    setStatus('');
  }

  btnStart.addEventListener('click', () => (App.camera.stream ? stop() : start()));

  async function loop() {
    if (!running) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const preds = await model.detect(video);
        handle(preds);
      }
    } catch (e) {
      console.error(e);
    }
    if (running) timer = setTimeout(loop, 700);
  }

  function handle(preds) {
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    const items = preds
      .filter(p => p.score >= 0.6)
      .map(p => {
        const [x, y, w, h] = p.bbox;
        const cx = (x + w / 2) / W;
        return {
          cls: p.class,
          label: PT[p.class] || p.class,
          score: p.score,
          pos: cx < 0.33 ? 'à esquerda' : cx > 0.66 ? 'à direita' : 'à frente',
          near: (w * h) / (W * H) > 0.25,
          area: w * h,
          bbox: p.bbox
        };
      })
      .sort((a, b) => b.area - a.area);
    lastItems = items;

    // desenha caixas
    ctx.lineWidth = Math.max(3, W / 250);
    ctx.font = `bold ${Math.max(16, Math.round(W / 40))}px Arial`;
    items.forEach(it => {
      const [x, y, w, h] = it.bbox;
      ctx.strokeStyle = it.near ? '#ff3b30' : '#ffd400';
      ctx.strokeRect(x, y, w, h);
      const text = `${it.label} ${Math.round(it.score * 100)}%`;
      const tw = ctx.measureText(text).width + 10;
      const th = Math.max(22, Math.round(W / 34));
      ctx.fillStyle = it.near ? '#ff3b30' : '#ffd400';
      ctx.fillRect(x, Math.max(0, y - th), tw, th);
      ctx.fillStyle = '#000';
      ctx.fillText(text, x + 5, Math.max(th - 6, y - 6));
    });

    // lista na tela
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.innerHTML = '<li class="muted">Nenhum objeto detectado.</li>';
    } else {
      items.forEach(it => {
        const li = document.createElement('li');
        li.textContent = `${App.cap(it.label)} ${it.pos}${it.near ? ', bem perto' : ''}`;
        if (it.near) li.classList.add('near');
        listEl.appendChild(li);
      });
    }

    // avisos automáticos
    if (autoBox.checked) {
      const now = Date.now();
      const fresh = items.filter(it => now - (lastSpoken[it.cls] || 0) > 8000).slice(0, 3);
      if (fresh.length) {
        fresh.forEach(it => { lastSpoken[it.cls] = now; });
        const phrase = fresh.map(it => `${App.cap(it.label)} ${it.pos}${it.near ? ', bem perto' : ''}`).join('. ') + '.';
        App.speak(phrase);
      }
    }
  }

  function describe() {
    if (!running) { App.speak('Ligue a câmera primeiro.'); return; }
    if (!lastItems.length) { App.speak('Não identifico nenhum objeto conhecido agora. Tente mover a câmera devagar.'); return; }
    const groups = {};
    lastItems.forEach(it => {
      (groups[it.cls] = groups[it.cls] || { label: it.label, n: 0, pos: it.pos, near: false });
      groups[it.cls].n++;
      if (it.near) groups[it.cls].near = true;
    });
    const parts = Object.values(groups).map(g =>
      g.n === 1 ? `1 ${g.label} ${g.pos}` : `${g.n} ${plural(g.label)}`);
    let text = 'Vejo: ' + listToSentence(parts) + '.';
    const near = lastItems.filter(i => i.near).map(i => i.label);
    if (near.length) text += ' Atenção: ' + listToSentence([...new Set(near)]) + ' bem perto.';
    App.speak(text);
  }
  btnDescribe.addEventListener('click', describe);

  App.objects = {
    describe,
    describeOrStart() { if (running) describe(); else start(); }
  };
})();
