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

  /* ---------- OCR com pré-processamento e comparação de resultados ---------- */
  function toCanvas(source, w, h) {
    const max = 2400; // mais resolução ajuda letras pequenas
    const scale = Math.min(2, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);

    // Aumenta contraste e aplica nitidez moderada sem alterar o texto semanticamente.
    const image = ctx.getImageData(0, 0, c.width, c.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
      d[i] = d[i + 1] = d[i + 2] = contrast;
    }
    ctx.putImageData(image, 0, 0);
    return c;
  }

  // Versão binarizada para páginas com fundo claro e impressão escura.
  function makeThresholdCanvas(source) {
    const c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    // Otsu: calcula um limiar global adequado à luminosidade da fotografia.
    const hist = new Array(256).fill(0);
    let total = d.length / 4, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
      hist[g]++; sum += g;
    }
    let sumB = 0, wB = 0, maxVariance = -1, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVariance) { maxVariance = variance; threshold = t; }
    }
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = g > threshold ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  function clean(t) {
    return (t || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[|•·]+|[|•·]+$/gm, '')
      .trim();
  }

  async function recognizePass(canvas, psm, logger) {
    const res = await Tesseract.recognize(canvas, 'por', {
      logger,
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: '1'
    });
    return { text: clean(res.data.text), confidence: Number(res.data.confidence) || 0 };
  }

  async function runOcr(canvas) {
    if (busy) return;
    if (typeof Tesseract === 'undefined') {
      const m = 'A biblioteca de leitura não foi carregada. Verifique a conexão com a internet e recarregue a página.';
      setStatus(m); App.speak(m); return;
    }
    busy = true;
    progress.hidden = false;
    progress.value = 0;
    setStatus('Preparando imagem para reconhecimento…');
    App.speak('Reconhecendo o texto. Aguarde alguns instantes.');
    try {
      const thresholdCanvas = makeThresholdCanvas(canvas);
      const logger = m => {
        if (m.status === 'recognizing text') {
          progress.value = m.progress;
          setStatus('Reconhecendo texto… ' + Math.round(m.progress * 100) + '%');
        } else if (m.status) setStatus('Preparando OCR: ' + m.status + '…');
      };
      // Executa modos complementares: bloco de texto e texto disperso.
      const results = [];
      results.push(await recognizePass(canvas, 6, logger));
      results.push(await recognizePass(thresholdCanvas, 6, logger));
      // O modo 11 é útil para textos em layouts, etiquetas ou blocos não uniformes.
      results.push(await recognizePass(canvas, 11, logger));
      const best = results
        .filter(r => r.text && r.text.replace(/\W/g, '').length >= 3)
        .sort((a, b) => b.confidence - a.confidence)[0];
      const text = best ? best.text : '';
      out.value = text;
      if (!text) {
        const m = 'Não encontrei texto legível. Enquadre somente o texto, aproxime a câmera, evite sombras e mantenha o celular firme.';
        setStatus(m); App.speak(m);
      } else {
        const low = best.confidence < 55 ? ' A confiança do reconhecimento está baixa; tente fotografar mais perto e com melhor iluminação.' : '';
        setStatus('Leitura concluída. Confiança estimada: ' + Math.round(best.confidence) + '%.');
        // O OCR deve reproduzir fielmente, sem correção gramatical generativa ou invenção de conteúdo.
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
