# Ver Além – Aplicativo de Apoio a Pessoas com Deficiência Visual

Projeto de extensão (Tecnologia Assistiva e Inclusão Digital). Site/aplicativo web com:

| Módulo | O que faz | Como funciona |
|---|---|---|
| **Leitor de texto (OCR)** | Lê em voz alta textos impressos captados pela câmera ou por uma imagem | Tesseract.js (português) + síntese de voz do navegador + aviso de pouca luz |
| **GPS com voz** | Diz onde você está, calcula rota a pé e orienta por voz, curva a curva | Geolocalização + OpenStreetMap (Nominatim e Leaflet) + rotas FOSSGIS/OSRM |
| **Reconhecimento de objetos** | Diz o que a câmera vê, onde está (esquerda/frente/direita) e se está bem perto | TensorFlow.js + modelo COCO-SSD (80 categorias) |
| **Interface acessível** | Voz liga/desliga e ajusta velocidade, letra maior/menor, alto contraste, comandos de voz | HTML semântico, ARIA, foco visível, botões grandes |
| **Avaliação** | Questionário de satisfação e autoavaliação, exportável em CSV | Salvo no navegador (localStorage) |

Além disso, o site apresenta as seções do projeto: justificativa, objetivos, público-alvo, metodologia e cronograma, recursos, aspectos éticos e resultados esperados.

## Como abrir no VS Code (passo a passo)

1. Instale o [Visual Studio Code](https://code.visualstudio.com/) e o navegador **Google Chrome** ou **Microsoft Edge**.
2. Descompacte o arquivo `ver-alem.zip`.
3. No VS Code: **Arquivo → Abrir Pasta…** e escolha a pasta `ver-alem`.
4. O VS Code vai sugerir instalar a extensão **Live Server** (Ritwick Dey). Clique em **Instalar**. Se não aparecer, abra a aba de Extensões (Ctrl+Shift+X), procure por *Live Server* e instale.
5. Abra o arquivo `index.html`, clique com o botão direito e escolha **Open with Live Server** (ou clique em **Go Live** no canto inferior direito).
6. O navegador abrirá em `http://localhost:5500`. A câmera e o microfone só serão solicitados ao ativar seus recursos. A localização só será solicitada ao tocar em **Onde estou?**, compartilhar a localização ou calcular uma rota.

### Alternativa sem extensão

No terminal do VS Code (Ctrl+`), dentro da pasta do projeto:

```bash
python -m http.server 5500
```

e abra `http://localhost:5500` no navegador. (Com Node.js: `npx serve -l 5500`.)

> **Por que precisa de servidor local?** Câmera, microfone e GPS só funcionam em endereços seguros: `https://` ou `http://localhost`. Abrir o `index.html` com duplo clique (`file://`) pode bloquear a localização.

## Requisitos

- **Internet** ao abrir a página: as bibliotecas (Leaflet, Tesseract.js, TensorFlow.js) e o idioma português do OCR são baixados da internet na primeira vez. Depois o navegador guarda em cache.
- **Chrome ou Edge** são recomendados. Os comandos de voz (reconhecimento) só funcionam nesses navegadores. Firefox e Safari têm suporte parcial.
- Para testar no celular, acesse o site pelo mesmo Wi-Fi usando o IP do computador (ex.: `http://192.168.0.10:5500`). **Atenção:** câmera e GPS no celular exigem `https`. Para isso, publique o site (GitHub Pages, Netlify, Vercel) ou use um túnel como o `ngrok`.

## Como usar

- **Comandos de voz** (botão 🎤 no topo): *ler texto*, *capturar*, *ler em voz alta*, *descrever objetos*, *onde estou*, *ir para [destino]*, *repetir*, *parar navegação*, *parar*, *compartilhar localização*, *aumentar letra*, *diminuir letra*, *contraste*, *ajuda*.
- **Leitor:** ligue a câmera, aponte para o texto e toque em *Capturar e ler*. Texto impresso, com boa luz e letra nítida, funciona melhor. Também dá para escolher uma imagem salva.
- **GPS:** toque em *Onde estou?* ou digite/fale um destino (ex.: “Praça da Sé, São Paulo”). Use **Simular caminhada** para demonstrar a navegação sem sair do lugar.
- **Usuários de leitor de tela (NVDA, JAWS, TalkBack, VoiceOver):** desligue o botão **Voz** do site para evitar fala dupla. A página usa HTML semântico e ARIA, e todos os botões têm rótulos.

## Estrutura de arquivos

```
ver-alem/
├── index.html          Página única (aplicativo + seções do projeto + avaliação)
├── css/style.css       Estilos, alto contraste e foco visível
├── js/
│   ├── core.js         Voz, configurações, abas, câmera e comandos de voz
│   ├── reader.js       Leitor de texto (OCR)
│   ├── objects.js      Reconhecimento de objetos
│   ├── gps.js          GPS, rota a pé e instruções por voz
│   └── eval.js         Questionário de avaliação
├── .vscode/            Sugestão da extensão Live Server
└── README.md
```

## Limitações conhecidas (seja transparente com os participantes)

- O reconhecimento de objetos usa o modelo COCO-SSD, com **80 categorias comuns** (pessoa, cadeira, mesa, celular, garrafa, carro, semáforo etc.). Ele **não reconhece** cédulas de dinheiro, rótulos de remédios ou obstáculos como degraus e buracos. Para isso seria preciso treinar um modelo próprio.
- O OCR erra mais com letras manuscritas, fotos tremidas, pouca luz e fundos coloridos.
- A precisão do GPS varia (5 a 30 m). Em locais fechados ou com prédios altos pode piorar.
- O aplicativo é experimental e **não substitui** bengala, cão-guia ou acompanhante. A navegação pode errar a posição ou a rota; não a utilize como único recurso de orientação. Nos testes de deslocamento, use monitores treinados.
- Os serviços gratuitos públicos de endereços (Nominatim) e rotas (FOSSGIS) têm limite de uso justo. Para uso em larga escala, hospede um serviço próprio ou use um provedor pago.

## Privacidade

As imagens da câmera são processadas **no próprio navegador** (OCR e detecção de objetos). O que sai do aparelho: a posição/endereço enviados aos serviços de mapas e rotas (para calcular o caminho) e o download das bibliotecas. As respostas do questionário ficam apenas no navegador (localStorage), em conformidade com a LGPD.

## Ideias para evoluir o projeto

- Treinar um modelo próprio para cédulas e produtos brasileiros (TensorFlow.js / Teachable Machine).
- Transformar em PWA para funcionar offline e ser instalado no celular.
- Modo “bússola” com direção (leste/oeste) usando o sensor de orientação.
- Painel de relatórios semanais dos alunos extensionistas.


Permissões: a localização não é solicitada automaticamente ao abrir a aba GPS. O pedido acontece após uma ação explícita, e solicitações simultâneas são compartilhadas para evitar prompts repetidos. Se o acesso for bloqueado, altere a permissão nas configurações do site e tente novamente. Use Chrome/Edge em https:// ou http://localhost.
