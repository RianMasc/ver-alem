/* ============================================================
   Leitor de texto (OCR) – câmera + Tesseract.js + voz
   ============================================================ */
(function () {
  'use strict';
  const { $ } = App;

  const video = $('#reader-video');
  const placeholder = $('#reader-placeholder');
  const btnStart = $('#reader-start');
  const btnCapture = $('#reader-capture');
  const fileInput = $('#reader-file');
  const progress = $('#reader-progress');
  const statusEl = $('#reader-status');
  const out = $('#reader-text');

  let busy = false;
  let lightTimer = null;
  let lastLight = 'ok';

  const setStatus = t => { statusEl.textContent = t; };

  /* ---------- câmera ---------- */
  function resetUi() {
    clearInterval(lightTimer);
    lightTimer = null;
    placeholder.hidden = false;
    btnCapture.disabled = true;
    btnStart.textContent = 'Ligar câmera';
    lastLight = 'ok';
  }

  async function startCamera() {
    try {
      await App.camera.start(video);
      placeholder.hidden = true;
      btnCapture.disabled = false;
      btnStart.textContent = 'Desligar câmera';
      lightTimer = setInterval(checkLight, 4000);
      App.speak('Câmera ligada. Aponte para o texto e toque em capturar e ler, ou diga capturar.');
    } catch (e) {
      resetUi();
      const msg = e && e.name === 'NotAllowedError'
        ? 'Permissão da câmera negada. Libere a câmera nas configurações do navegador.'
        : (e && e.message) || 'Não foi possível ligar a câmera.';
      setStatus(msg);
      App.speak(msg);
    }
  }

  function stopCamera() {
    App.camera.stop();
    resetUi();
  }

  btnStart.addEventListener('click', () => (App.camera.stream ? stopCamera() : startCamera()));
  document.addEventListener('tabchange', resetUi);

  /* ---------- aviso de pouca luz ---------- */
  function brightness(source, w, h) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = Math.max(1, Math.round(64 * h / w));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  }
  function checkLight() {
    if (!video.videoWidth || busy) return;
    const b = brightness(video, video.videoWidth, video.videoHeight);
    const state = b < 55 ? 'dark' : 'ok';
    if (state === 'dark' && lastLight !== 'dark') {
      App.speak('Pouca luz. Acenda uma luz ou aproxime o texto de uma janela.');
    }
    lastLight = state;
  }

  /* ---------- OCR ---------- */
  function toCanvas(source, w, h) {
    const max = 1800;
    const scale = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.35)';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  const clean = t => t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  async function runOcr(canvas) {
    if (busy) return;
    if (typeof Tesseract === 'undefined') {
      const m = 'A biblioteca de leitura não foi carregada. Verifique a conexão com a internet e recarregue a página.';
      setStatus(m); App.speak(m); return;
    }
    busy = true;
    progress.hidden = false;
    progress.value = 0;
    setStatus('Reconhecendo texto…');
    App.speak('Reconhecendo o texto. Aguarde alguns instantes.');
    try {
      const res = await Tesseract.recognize(canvas, 'por', {
        logger: m => {
          if (m.status === 'recognizing text') {
            progress.value = m.progress;
            setStatus('Reconhecendo texto… ' + Math.round(m.progress * 100) + '%');
          } else if (m.status) {
            setStatus('Preparando: ' + m.status + '…');
          }
        }
      });
      const text = clean(res.data.text || '');
      out.value = text;
      if (!text || text.replace(/\W/g, '').length < 3) {
        const m = 'Não encontrei texto na imagem. Aproxime, melhore a iluminação e mantenha o celular firme.';
        setStatus(m); App.speak(m);
      } else {
        const low = res.data.confidence < 45 ? ' Atenção: a leitura pode conter erros.' : '';
        setStatus('Leitura concluída' + (low ? ' (confiança baixa).' : '.'));
        App.speak('Texto reconhecido.' + low + ' ' + text);
      }
    } catch (e) {
      console.error(e);
      const m = 'Ocorreu um erro na leitura. Verifique a internet e tente de novo.';
      setStatus(m); App.speak(m);
    } finally {
      busy = false;
      progress.hidden = true;
    }
  }

  async function capture() {
    if (!App.camera.stream || !video.videoWidth) {
      await startCamera();
      App.speak('Câmera ligada. Agora toque em capturar e ler.');
      return;
    }
    const b = brightness(video, video.videoWidth, video.videoHeight);
    if (b < 40) App.speak('Está muito escuro, a leitura pode falhar. Tentando mesmo assim.');
    runOcr(toCanvas(video, video.videoWidth, video.videoHeight));
  }
  btnCapture.addEventListener('click', capture);

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      runOcr(toCanvas(img, img.naturalWidth, img.naturalHeight));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => App.speak('Não consegui abrir essa imagem.');
    img.src = URL.createObjectURL(f);
    fileInput.value = '';
  });

  /* ---------- botões do texto ---------- */
  function readAloud() {
    const t = out.value.trim();
    if (!t) { App.speak('Ainda não há texto lido. Capture uma imagem primeiro.'); return; }
    App.speak(t);
  }
  $('#reader-read').addEventListener('click', readAloud);
  $('#reader-stop').addEventListener('click', () => App.stopSpeaking());
  $('#reader-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(out.value); App.speak('Texto copiado.'); }
    catch (e) { out.select(); App.speak('Selecione e copie o texto manualmente.'); }
  });
  $('#reader-clear').addEventListener('click', () => { out.value = ''; setStatus(''); App.speak('Texto apagado.'); });

  App.reader = { capture, readAloud, start: startCamera };
})();
