/* ============================================================
   Avaliação de satisfação e autoavaliação (salva no navegador)
   ============================================================ */
(function () {
  'use strict';
  const { $, $$ } = App;

  const KEY = 'ver-alem-avaliacoes';
  const form = $('#eval-form');
  const msg = $('#eval-msg');
  const countEl = $('#eval-count');

  // monta os botões de 1 a 5
  $$('.scale').forEach(box => {
    const q = box.dataset.q;
    for (let n = 1; n <= 5; n++) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = q;
      input.value = String(n);
      input.required = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + n));
      box.appendChild(label);
    }
  });

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const store = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } };
  const refresh = () => { countEl.textContent = String(load().length); };

  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    const item = {
      data: new Date().toLocaleString('pt-BR'),
      participante: ($('#eval-name').value || '').trim(),
      q1: data.get('q1'), q2: data.get('q2'), q3: data.get('q3'), q4: data.get('q4'), q5: data.get('q5'),
      comentario: ($('#eval-comment').value || '').trim()
    };
    const list = load();
    list.push(item);
    if (store(list)) {
      msg.textContent = 'Respostas salvas. Obrigado pela participação!';
      App.speak('Respostas salvas. Obrigado pela participação!');
      form.reset();
      refresh();
    } else {
      msg.textContent = 'Não foi possível salvar neste navegador.';
    }
  });

  $('#eval-export').addEventListener('click', () => {
    const list = load();
    if (!list.length) { msg.textContent = 'Ainda não há respostas para baixar.'; App.speak('Ainda não há respostas para baixar.'); return; }
    // Evita que conteúdo digitado seja interpretado como fórmula ao abrir o CSV em planilhas.
    const esc = v => {
      let value = String(v == null ? '' : v);
      if (/^[\s]*[=+@-]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    };
    const head = ['Data', 'Participante', 'Facilidade de uso', 'Leitura de textos', 'GPS com voz', 'Reconhecimento de objetos', 'Autonomia', 'Comentário'];
    const rows = list.map(r => [r.data, r.participante, r.q1, r.q2, r.q3, r.q4, r.q5, r.comentario].map(esc).join(';'));
    const csv = '\uFEFF' + head.map(esc).join(';') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'avaliacoes-ver-alem.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg.textContent = 'Arquivo CSV gerado.';
  });

  $('#eval-clear').addEventListener('click', () => {
    if (!load().length) return;
    if (confirm('Apagar TODAS as respostas salvas neste navegador?')) {
      store([]);
      refresh();
      msg.textContent = 'Respostas apagadas.';
    }
  });

  refresh();
})();
