/* ============================================================
   Ver Além – núcleo: voz, configurações, abas, câmera e comandos
   ============================================================ */
(function () {
  'use strict';

  const App = (window.App = {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  App.$ = $;
  App.$$ = $$;

  /* ---------- Configurações (salvas no navegador) ---------- */
  const KEY = 'ver-alem-config';
  const defaults = { voice: true, rate: 1, fontScale: 1, contrast: false };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* ignora */ }
  App.settings = Object.assign({}, defaults, saved);
  const saveSettings = () => { try { localStorage.setItem(KEY, JSON.stringify(App.settings)); } catch (e) { /* ignora */ } };

  function applySettings() {
    document.documentElement.style.fontSize = Math.round(App.settings.fontScale * 100) + '%';
    document.body.classList.toggle('hc', App.settings.contrast);
    $('#btn-contrast').setAttribute('aria-pressed', String(App.settings.contrast));
    const v = $('#btn-voice');
    v.setAttribute('aria-pressed', String(App.settings.voice));
    v.querySelector('.lbl').textContent = App.settings.voice ? 'Voz ligada' : 'Voz desligada';
    $('#rate').value = App.settings.rate;
  }

  /* ---------- Voz (síntese) ---------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let ptVoice = null;
  let speaking = false;
  let lastEnd = 0;

  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    ptVoice = vs.find(v => v.lang === 'pt-BR') || vs.find(v => v.lang && v.lang.toLowerCase().startsWith('pt')) || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

  const captionEl = $('#caption');
  let captionTimer = null;
  function showCaption(text) {
    captionEl.textContent = text;
    captionEl.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { captionEl.hidden = true; }, 15000);
  }

  /**
   * Fala um texto em português. Devolve uma Promise resolvida quando a fala termina.
   * A legenda (texto grande na tela) aparece mesmo com a voz desligada.
   */
  App.speak = function (text, opts = {}) {
    const interrupt = opts.interrupt !== false;
    if (!text) return Promise.resolve();
    showCaption(text);
    if (!synth || !App.settings.voice) return Promise.resolve();
    if (interrupt) synth.cancel();
    // O Chrome corta falas longas: dividimos em frases.
    const parts = (text.match(/[^.!?\n]+[.!?]?/g) || [text]).map(s => s.trim()).filter(Boolean);
    return new Promise(resolve => {
      const safety = setTimeout(resolve, 60000);
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = 'pt-BR';
        u.rate = App.settings.rate;
        if (ptVoice) u.voice = ptVoice;
        u.onstart = () => { speaking = true; };
        if (i === parts.length - 1) {
          const done = () => { speaking = false; lastEnd = Date.now(); clearTimeout(safety); resolve(); };
          u.onend = done;
          u.onerror = done;
        }
        synth.speak(u);
      });
    });
  };
  App.stopSpeaking = function () { if (synth) synth.cancel(); speaking = false; lastEnd = Date.now(); };

  /* ---------- Câmera (uma por vez) ---------- */
  App.camera = {
    stream: null,
    video: null,
    async start(video) {
      this.stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Este navegador não permite acesso à câmera. Use o Chrome ou o Edge e abra o site por http://localhost.');
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        this.video = video;
        video.srcObject = this.stream;
        await video.play();
      } catch (error) {
        // Se a reprodução falhar depois de obter a câmera, libera os recursos.
        this.stop();
        throw error;
      }
    },
    stop() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.video) this.video.srcObject = null;
      this.stream = null;
      this.video = null;
    }
  };

  /* ---------- Abas ---------- */
  const TAB_HELP = {
    reader: 'Leitor de texto. Ligue a câmera, aponte para o texto e toque em capturar e ler.',
    objects: 'Reconhecimento de objetos. Ligue a câmera e aponte ao redor. Eu direi o que vejo.',
    gps: 'Navegação com voz. Toque em onde estou, ou digite ou diga um destino.'
  };
  App.currentTab = 'reader';
  App.showTab = function (name, opts = {}) {
    App.currentTab = name;
    $$('[role="tab"]').forEach(t => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$('[role="tabpanel"]').forEach(p => { p.hidden = p.id !== 'panel-' + name; });
    App.camera.stop();
    document.dispatchEvent(new CustomEvent('tabchange', { detail: name }));
    if (opts.announce !== false) App.speak(TAB_HELP[name]);
  };
  $$('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => App.showTab(tab.dataset.tab));
    tab.addEventListener('keydown', e => {
      const tabs = $$('[role="tab"]');
      const i = tabs.indexOf(tab);
      let n = null;
      if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
      if (n) { e.preventDefault(); n.focus(); App.showTab(n.dataset.tab); }
    });
  });

  /* ---------- Barra de acessibilidade ---------- */
  $('#btn-voice').addEventListener('click', () => {
    App.settings.voice = !App.settings.voice;
    if (!App.settings.voice) App.stopSpeaking();
    saveSettings(); applySettings();
    if (App.settings.voice) App.speak('Voz ligada.');
  });
  $('#rate').addEventListener('input', e => { App.settings.rate = parseFloat(e.target.value); saveSettings(); });
  $('#rate').addEventListener('change', () => App.speak('Esta é a velocidade da voz.'));
  const fontStep = d => {
    App.settings.fontScale = Math.min(1.6, Math.max(0.9, Math.round((App.settings.fontScale + d) * 100) / 100));
    saveSettings(); applySettings();
  };
  $('#btn-font-plus').addEventListener('click', () => fontStep(0.15));
  $('#btn-font-minus').addEventListener('click', () => fontStep(-0.15));
  $('#btn-contrast').addEventListener('click', () => {
    App.settings.contrast = !App.settings.contrast;
    saveSettings(); applySettings();
    App.speak(App.settings.contrast ? 'Alto contraste ligado.' : 'Alto contraste desligado.');
  });

  const HELP_TEXT =
    'Bem-vindo ao Ver Além. Há três módulos: leitor de texto, reconhecimento de objetos e navegação por GPS. ' +
    'Para usar comandos de voz, ative o botão do microfone na barra do topo. Você pode dizer: ler texto, capturar, ' +
    'descrever objetos, onde estou, ir para seguido do destino, repetir, parar, aumentar letra, diminuir letra e contraste.';
  $('#btn-help').addEventListener('click', () => App.speak(HELP_TEXT));

  /* ---------- Comandos de voz (reconhecimento) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let micOn = false;
  let dictating = false;
  let recStarting = false;
  let recStopping = false;
  let micPermissionDenied = false;
  let restartTimer = null;

  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();

  const COMMANDS = [
    [/(?:ir para|ir ate|navegar para|rota para|me levar para|levar me para)\s+(.+)/, m => { App.showTab('gps', { announce: false }); if (App.gps) App.gps.goTo(m[1]); }],
    [/parar (?:a )?navegacao|cancelar rota|encerrar rota/, () => App.gps && App.gps.stop()],
    [/onde estou|minha localizacao|qual minha posicao/, () => { App.showTab('gps', { announce: false }); App.gps && App.gps.whereAmI(); }],
    [/compartilhar/, () => { App.showTab('gps', { announce: false }); App.gps && App.gps.share(); }],
    [/parar|silencio|calar|cala a boca/, () => App.stopSpeaking()],
    [/ler em voz alta|reler|ler de novo|ler o texto/, () => App.reader && App.reader.readAloud()],
    [/capturar|tirar foto|fotografar|ler documento/, () => { App.showTab('reader', { announce: false }); App.reader && App.reader.capture(); }],
    [/descrever|o que (?:tem|ha|estou vendo)|ao redor|objeto/, () => { App.showTab('objects', { announce: false }); App.objects && App.objects.describeOrStart(); }],
    [/repetir/, () => { if (App.currentTab === 'gps' && App.gps) App.gps.repeat(); else if (App.reader) App.reader.readAloud(); }],
    [/navegar|gps|rota/, () => App.showTab('gps')],
    [/ler texto|leitor|texto/, () => App.showTab('reader')],
    [/aumentar/, () => fontStep(0.15)],
    [/diminuir/, () => fontStep(-0.15)],
    [/contraste/, () => $('#btn-contrast').click()],
    [/ajuda|comandos/, () => App.speak(HELP_TEXT)]
  ];

  function handleSpeech(raw) {
    const t = norm(raw);
    if (!t) return;
    for (const [re, fn] of COMMANDS) {
      const m = t.match(re);
      if (m) { fn(m); return; }
    }
    App.speak('Não entendi o comando: ' + raw + '. Diga ajuda para ouvir a lista.');
  }

  function scheduleRecStart() {
    clearTimeout(restartTimer);
    if (!micOn || dictating || micPermissionDenied) return;
    restartTimer = setTimeout(() => startRec(), 500);
  }

  function startRec() {
    if (!SR || !micOn || dictating || micPermissionDenied || recStarting) return;
    if (!rec) {
      rec = new SR();
      rec.lang = 'pt-BR';
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        recStarting = false;
        recStopping = false;
        setMic(true);
      };

      rec.onresult = e => {
        if (speaking || Date.now() - lastEnd < 1200) return;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) handleSpeech(e.results[i][0].transcript);
        }
      };

      rec.onerror = e => {
        recStarting = false;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          micPermissionDenied = true;
          micOn = false;
          clearTimeout(restartTimer);
          setMic(false);
          App.speak('O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço do site, permita o microfone e depois ative os comandos de voz novamente.');
        } else if (['audio-capture', 'network', 'language-not-supported'].includes(e.error)) {
          micOn = false;
          clearTimeout(restartTimer);
          setMic(false);
          App.speak(e.error === 'audio-capture' ? 'Não consegui acessar o microfone. Confira o dispositivo de entrada do Windows.' : 'O serviço de reconhecimento de fala falhou. Teste no Google Chrome ou Microsoft Edge e confira a conexão com a internet.');
        } else if (e.error === 'no-speech') {
          // Não reinicia em sequência após ausência de fala; evita ciclo de tentativas.
          micOn = false;
          clearTimeout(restartTimer);
          setMic(false);
          App.speak('Não detectei fala. Ative os comandos de voz novamente e fale após o aviso.');
        }
      };

      rec.onend = () => {
        recStarting = false;
        recStopping = false;
        // Não reinicia em loop quando o usuário desligou ou quando a permissão foi negada.
        if (micOn && !dictating && !micPermissionDenied) scheduleRecStart();
      };
    }

    try {
      recStarting = true;
      rec.start();
    } catch (e) {
      recStarting = false;
      // Se já estiver ouvindo, não tenta iniciar outra instância.
      if (e && e.name === 'InvalidStateError') return;
      scheduleRecStart();
    }
  }

  function setMic(on) {
    const b = $('#btn-mic');
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.lbl').textContent = on ? 'Ouvindo comandos' : 'Comandos de voz';
  }

  $('#btn-mic').addEventListener('click', () => {
    if (!SR) {
      App.speak('Comandos de voz não estão disponíveis neste navegador. Use o Google Chrome ou o Microsoft Edge.');
      return;
    }

    if (micOn) {
      micOn = false;
      clearTimeout(restartTimer);
      setMic(false);
      try { if (rec) rec.stop(); } catch (e) { /* já parado */ }
      App.speak('Comandos de voz desligados.');
      return;
    }

    // Permite uma nova tentativa depois que o usuário corrigiu a permissão.
    micPermissionDenied = false;
    dictating = false;
    micOn = true;
    setMic(true);

    // Inicia o reconhecimento diretamente após o clique. Isso evita perder a ativação
    // do usuário em navegadores que exigem uma interação para solicitar o microfone.
    startRec();
    App.speak('Comandos de voz ligados. Diga ajuda para ouvir a lista.');
  });

  /** Ditado de uma única frase (usado para falar o destino). */
  App.dictate = async function (callback, prompt) {
    if (!SR) {
      App.speak('O reconhecimento de fala não está disponível neste navegador. Abra o Ver Além no Google Chrome ou Microsoft Edge.');
      return;
    }

    // Suspende o reconhecimento contínuo e espera o evento end antes de abrir
    // outra sessão. Iniciar duas sessões quase ao mesmo tempo pode falhar sem aviso.
    dictating = true;
    clearTimeout(restartTimer);
    if (rec) {
      try {
        await new Promise(resolve => {
          let finished = false;
          const done = () => { if (!finished) { finished = true; resolve(); } };
          rec.addEventListener('end', done, { once: true });
          try { rec.stop(); } catch (e) { done(); }
          setTimeout(done, 1200);
        });
      } catch (e) { /* continua para a tentativa de ditado */ }
    }
    await App.speak(prompt || 'Pode falar.');

    const r = new SR();
    r.lang = 'pt-BR';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let got = false;
    let finished = false;
    let heardAudio = false;
    let reportedError = false;
    let startTimer = null;
    let dictationTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(startTimer);
      clearTimeout(dictationTimer);
      dictating = false;
      try { r.onresult = null; } catch (e) {}
      try { r.stop(); } catch (e) {}
      if (micOn && !micPermissionDenied) scheduleRecStart();
    };
    r.onaudiostart = () => { heardAudio = true; };
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal && e.results[i][0].transcript.trim()) {
          got = true;
          try { callback(e.results[i][0].transcript.trim()); }
          catch (err) { console.error('Erro ao processar o texto reconhecido:', err); }
        }
      }
    };
    r.onerror = e => {
      const messages = {
        'not-allowed': 'O navegador não autorizou o reconhecimento. Confira a permissão do microfone para este site.',
        'service-not-allowed': 'O serviço de reconhecimento de fala foi bloqueado pelo navegador. Teste no Google Chrome ou Microsoft Edge.',
        'audio-capture': 'Não consegui acessar um microfone. Confira se ele está conectado e selecionado no Windows.',
        'network': 'O reconhecimento de fala falhou por um problema de rede ou do serviço de transcrição.',
        'language-not-supported': 'O reconhecimento de fala em português do Brasil não está disponível neste navegador.',
        'no-speech': 'Não detectei fala. Toque no microfone e fale logo após o aviso.',
        'aborted': 'O reconhecimento de fala foi interrompido.'
      };
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micPermissionDenied = true;
        micOn = false;
        setMic(false);
      }
      reportedError = true;
      if (!got) App.speak(messages[e.error] || ('Falha no reconhecimento de fala: ' + e.error + '.'));
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error)) finish();
    };
    r.onend = () => {
      if (!got && !finished && !reportedError) {
        App.speak(heardAudio ? 'Recebi áudio, mas não consegui transcrever sua fala. Tente novamente falando claramente e confira se o serviço de reconhecimento está disponível.' : 'O microfone não enviou áudio ao reconhecimento. Confira a entrada de áudio do Windows e teste no Chrome ou Edge.');
      }
      finish();
    };
    try {
      r.start();
      // Evita deixar o ditado preso indefinidamente se o serviço não responder.
      startTimer = setTimeout(() => {
        if (!heardAudio && !got && !finished) {
          reportedError = true;
          App.speak('O reconhecimento não começou a receber áudio. Verifique o microfone do Windows e tente no Google Chrome ou Microsoft Edge.');
          finish();
        }
      }, 5000);
      dictationTimer = setTimeout(() => {
        if (!got && !finished) {
          reportedError = true;
          App.speak('Não consegui reconhecer o endereço dentro do tempo limite. Toque no microfone e tente novamente.');
          finish();
        }
      }, 12000);
    } catch (e) {
      finish();
      App.speak('Não consegui iniciar o microfone. Aguarde um instante e tente novamente.');
      console.error('Falha ao iniciar SpeechRecognition:', e);
    }
  };

  /* ---------- Utilitários compartilhados ---------- */
  App.cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  App.lc = s => s.charAt(0).toLowerCase() + s.slice(1);

  /* ---------- Aviso: câmera/microfone exigem contexto seguro ---------- */
  if (!window.isSecureContext) {
    const w = document.createElement('div');
    w.className = 'ctx-warning';
    w.setAttribute('role', 'alert');
    w.innerHTML = '⚠️ Você abriu o arquivo direto (file://). Câmera e comandos de voz só funcionam em <strong>https://</strong> ou <strong>http://localhost</strong>. ' +
      'Para testar: no VS Code, instale a extensão "Live Server" e clique em "Go Live"; ou abra um terminal nesta pasta e rode <code>python -m http.server 8000</code>, depois acesse http://localhost:8000.';
    document.body.insertBefore(w, document.body.firstChild);
    App.speak('Atenção. Você abriu o arquivo diretamente. Câmera e comandos de voz não vão funcionar assim. É preciso servir os arquivos por http localhost, usando por exemplo o Live Server do Visual Studio Code.');
  }

  applySettings();
  App.showTab('reader', { announce: false });
})();
