# ⚡ Peitada Futevôlei — Análise Biomecânica em Tempo Real

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Online-brightgreen?style=for-the-badge&logo=github)](https://meneguinha.github.io/peitada_futevolei/)
[![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Vision%203D-FF6F00?style=for-the-badge&logo=google)](https://developers.google.com/mediapipe)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

Aplicação web progressiva para **análise biomecânica automatizada em tempo real de ataques de peito ("Peitada") no futevôlei**. Utiliza Inteligência Artificial, estimativa de pose 3D em metros e algoritmos geométricos para avaliar a execução do movimento, identificar falhas técnicas e recomendar exercícios corretivos diretamente no navegador, sem necessidade de servidores externos ou upload de dados.

---

## 🌐 Acesse a Aplicação Online

- 🚀 **GitHub Pages App**: [https://meneguinha.github.io/peitada_futevolei/](https://meneguinha.github.io/peitada_futevolei/)
- 💻 **Repositório GitHub**: [https://github.com/meneguinha/peitada_futevolei](https://github.com/meneguinha/peitada_futevolei)

---

## 📌 Sobre o Projeto

A **"Peitada"** é um dos movimentos de ataque mais plásticos e eficientes do futevôlei. Uma execução perfeita exige sincronia biomecânica entre:
1. **Flexão prévia de joelhos** para impulsão (efeito mola);
2. **Arqueamento do tronco** para posicionamento abaixo da bola;
3. **Avanço explosivo do quadril** (hip thrust) no momento do impacto para gerar potência;
4. **Abertura e simetria dos braços** para equilíbrio aéreo e direcionamento.

Esta aplicação resolve o desafio de avaliar objetivamente esse movimento. Ao analisar vídeos em câmera lenta ou em velocidade normal, o sistema identifica automaticamente o exato momento de cada peitada em uma partida ou treino, calcula os ângulos tridimensionais do atleta e gera uma **nota biomecânica (0 a 100)** acompanhada de relatórios e dicas técnicas.

---

## ✨ Principais Funcionalidades

- 🎯 **Detecção Automática via Máquina de Estados 3D**:
  - Identifica automaticamente os eventos de peitada sem necessidade de marcação manual, operando nas fases:
    $$\text{IDLE} \rightarrow \text{PREPARING} \rightarrow \text{ARCHING} \rightarrow \text{IMPACT} \rightarrow \text{LANDING} \rightarrow \text{IDLE}$$
  - Filtro contra falso-positivos e prevenção de contagem duplicada em rallies rápidos.

- 📐 **Análise Biomecânica 3D em Metros (MediaPipe Pose)**:
  - Utiliza coordenadas métricas tridimensionais (*World Landmarks* com origem no quadril) fornecidas pelo MediaPipe Pose.
  - Imune à distorção de aspecto do vídeo (como vídeos 9:16 de celular vs. 16:9), inclinação da câmera ou distância do atleta.

- ⚽ **Rastreamento Integrado da Bola (Ball Tracker)**:
  - Algoritmo de visão computacional e ajuste de trajetória de bola integrado ao ciclo de vida do movimento para validar o ponto exato do impacto.

- 📊 **Relatório Biomecânico Instantâneo**:
  - Diagnóstico detalhado mostrando a nota de cada componente (joelhos, tronco, braços, quadril) e o resumo geral do atleta.

- 💡 **Recomendações e Drills de Treino Personalizados**:
  - Sugestões inteligentes de exercícios corretivos baseadas nos erros específicos detectados no vídeo (ex: perna dura, falta de projeção de quadril, arqueamento insuficiente ou excessivo).

- 🎥 **Reprodutor de Vídeo Técnico Avançado**:
  - Reprodução em câmera lenta configurável (**0.25x**, **0.5x**, **1.0x**).
  - Suporte a navegação frame a frame e salto direto para os picos de cada peitada registrada.
  - Overlay gráfico do esqueleto 3D com destaque de cores nos ângulos chave (pode ser ativado/desativado).
  - Servidor local dev com suporte a requisições **HTTP 206 Byte-Range** para vídeos MP4 de alta definição.

- 🔒 **Privacidade Total & Execução Client-Side**:
  - Todo o processamento de visão computacional roda 100% no navegador do usuário via WebGL e WebAssembly. Nenhum frame de vídeo é enviado para servidores.

- 🔔 **Feedback Sonoro & Efeitos Visuais**:
  - Efeitos sonoros sintetizados em tempo real via **Web Audio API** para sinalizar momentos de impacto e notas.
  - Explosão de confetes (`canvas-confetti`) em execuções de alta performance (nota $\ge 85$).

- 🌓 **Tema Claro / Escuro (Light & Dark Mode)**:
  - Interface responsiva e elegante com alternância instantânea de tema visual.

---

## 📐 Modelo Biomecânico & Métricas Medidas

No momento do **pico do arqueamento**, a aplicação analisa 33 pontos corporais e avalia 4 métricas fundamentais:

| Métrica | Faixa Ideal / Alvo | Peso no Score | Descrição Biomecânica |
| :--- | :---: | :---: | :--- |
| 🔙 **Arco do Tronco** | **20° a 40°** | **30%** | Ângulo entre a linha do tronco (quadril $\rightarrow$ ombros) e a linha vertical. Valores abaixo de 18° no pico não qualificam o movimento como peitada. |
| 🦵 **Flexão do Joelho** | **120° a 150°** | **30%** | Ângulo do joelho (quadril $\rightarrow$ joelho $\rightarrow$ tornozelo). Ângulos acima de 165° indicam "perna dura" (perda de impulsão); abaixo de 100° indicam agachamento excessivo (perda de tempo de bola). |
| 💪 **Simetria dos Braços** | **Diferença < 15°** | **20%** | Comparação angular do cotovelo esquerdo vs. direito. Braços abertos simetricamente garantem estabilidade no ar. |
| 🏋️ **Avanço do Quadril (Hip Thrust)** | **> 0.07** | **20%** | Projeção do quadril à frente dos tornozelos no eixo de ataque, medida como proporção da altura corporal do atleta (independente de zoom/distância da câmera). |

---

## 📂 Arquitetura do Projeto

```text
peitada_futevolei/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Workflow de CI/CD para build e deploy no GitHub Pages
├── public/                     # Arquivos estáticos e vídeos de demonstração
│   ├── sample_peitada.mp4
│   └── favicon.svg
├── src/
│   ├── assets/                 # Recursos visuais e mídias
│   ├── components/             # Componentes React da Interface
│   │   ├── BiomechanicsReport.jsx   # Relatório e notas biomecânicas
│   │   ├── DrillRecommendations.jsx # Recomendações de treinos corretivos
│   │   ├── Header.jsx               # Cabeçalho, botões de ação e seletor de tema
│   │   ├── HowItWorks.jsx           # Explicação visual e interativa das métricas
│   │   ├── Logo.jsx                 # Logotipo da aplicação
│   │   ├── MetricsBadge.jsx         # Chips de métricas em tempo real
│   │   ├── PhaseTimeline.jsx        # Linha do tempo dos eventos detectados
│   │   ├── PoseCanvasOverlay.jsx    # Canvas 2D/3D sobreposto ao vídeo
│   │   ├── VideoAnalyzer.jsx        # Player de vídeo e gerenciador do loop de detecção
│   │   └── VideoUploader.jsx        # Dropzone e seletor de vídeos de exemplo
│   ├── utils/                  # Motores de IA, Matemática e Biomecânica
│   │   ├── angleDetector.js         # Cálculos de ângulos anatômicos
│   │   ├── ballTracker.js           # Rastreamento de bola por visão computacional
│   │   ├── biomechanicsEngine.js    # Motor de análise biomecânica integrada
│   │   ├── figureGeometry.js        # Geometria do modelo ilustrativo
│   │   ├── geometryMath.js          # Matemática vetorial 3D e ângulos no espaço
│   │   ├── peitadaDetector.js       # Detector de peitada e máquina de estados
│   │   ├── poseDetector.js          # Inicializador e chamadas do MediaPipe Pose
│   │   ├── sampleData.js            # Dados e configurações de vídeos de exemplo
│   │   └── theme.js                 # Gerenciador de tema visual (light/dark)
│   ├── App.jsx                 # Componente raiz da aplicação
│   ├── App.css                 # Estilos específicos dos componentes
│   ├── index.css               # Design System, variáveis HSL e resets CSS
│   └── main.jsx                # Ponto de entrada do React 19
├── test/
│   └── peitadaDetector.test.mjs # Suíte de testes unitários automatizados da biomecânica
├── .oxlintrc.json              # Configurações do Linter Oxlint
├── index.html                  # HTML principal da aplicação
├── package.json                # Dependências do projeto e scripts
└── vite.config.js              # Configurações do Vite (base path /peitada_futevolei/)
```

---

## 🛠️ Tecnologias Utilizadas

- **Core Framework**: [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/)
- **Visão Computacional & IA**: [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) & [@tensorflow/tfjs](https://www.tensorflow.org/js) (WebGL Backend)
- **Estilização**: Vanilla CSS com variáveis dinâmicas em HSL e Design System customizado (sem frameworks CSS pesados)
- **Ícones**: [Lucide React](https://lucide.dev/)
- **Animação & Efeitos**: `canvas-confetti` & Web Audio API (Síntese de áudio nativa)
- **Testes & Qualidade**: Node.js ESM Test Runner & [Oxlint](https://oxc.rs/)
- **Deploy & Hospedagem**: GitHub Actions & GitHub Pages

---

## ⚡ Como Executar Localmente

### Pré-requisitos
- **Node.js**: Versão 18 ou superior instalada.
- **npm**: Versão 9 ou superior.

### Passo a Passo

1. **Clonar o repositório:**
   ```bash
   git clone https://github.com/meneguinha/peitada_futevolei.git
   cd peitada_futevolei
   ```

2. **Instalar as dependências:**
   ```bash
   npm install
   ```

3. **Iniciar o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```
   Acesse a aplicação no navegador pelo endereço exibido no terminal (geralmente `http://localhost:5173/peitada_futevolei/`).

4. **Executar a suíte de testes unitários:**
   ```bash
   npm test
   ```

5. **Verificar a sintaxe e linter:**
   ```bash
   npm run lint
   ```

6. **Gerar a versão de produção (Build):**
   ```bash
   npm run build
   ```

---

## 🧪 Suíte de Testes Automatizados

O projeto conta com uma suíte de testes rigorosa em `test/peitadaDetector.test.mjs`, que simula atletas virtuais com diferentes características antropométricas, variações no ângulo da câmera (*yaw*), movimentos corretos e movimentos incorretos.

Para executar os testes:
```bash
npm test
```

Os testes cobrem:
- Detecção precisa de arcos de tronco e ângulos de joelho sintetizados geometricamente.
- Tolerância a variações de rotação da câmera (perspectiva em perfil 90° vs. frontal 0°).
- Validação das regresses biomecânicas e pontuação da máquina de estados.

---

## 🚀 Deployment Automático (GitHub Pages)

O deploy é configurado automaticamente via **GitHub Actions** em cada push para o branch `main`.

- Arquivo de workflow: `.github/workflows/deploy.yml`
- Base URL no `vite.config.js`: `base: '/peitada_futevolei/'`
- Link de Acesso Público: **[https://meneguinha.github.io/peitada_futevolei/](https://meneguinha.github.io/peitada_futevolei/)**

---

## 📄 Licença

Este projeto está licenciado sob a Licença **MIT**. Veja o arquivo `LICENSE` para mais detalhes.

---

<p center>
  Desenvolvido com ⚽ e IA para a comunidade de <strong>Futevôlei</strong>.
</p>

