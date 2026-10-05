/**
 * Симулятор.
 *
 * Грузит собранный playable в iframe с подставленным SDK фейковой сети и
 * показывает, что именно вызвал playable. Это то, что превращает «у меня на
 * машине работает» в «установка работает в контейнере формы AppLovin».
 *
 * Интерфейс на русском: проект русскоязычный, и инструмент для владельца
 * репозитория должен читаться без перевода.
 */
import { SIMULATIONS, createBridge, type BridgeLogEntry, type SimulatedNetwork } from './bridge.js';

/**
 * Built playable, copied into `public/` by the build step.
 *
 * The simulator deliberately serves the real single-file artefact rather than
 * the game's dev-server build: the whole point is to test what would actually be
 * uploaded, size and inline-asset behaviour included.
 *
 * Two artefacts, because they are not interchangeable: the Meta build has no
 * MRAID code, so running it under a MRAID container would (correctly) fail to
 * detect a bridge and fall back. Picking the wrong one therefore produces a
 * false negative rather than a false positive, but the log makes it obvious.
 */
/**
 * Base URL of the served site.
 *
 * Not `import.meta.url`: in dev that resolves to `/src/`, so the playable would
 * be requested from `/src/playable.html` while the file is served from
 * `public/` at the root. `BASE_URL` is `'/'` in dev and the deploy base in a
 * static build, which is what both cases need.
 */
const BASE_URL = import.meta.env.BASE_URL;

const PLAYABLE_SOURCES = {
  web: `${BASE_URL}playable.html`,
  meta: `${BASE_URL}playable-meta.html`,
} as const;

/** Networks that need the MRAID build versus the Meta build. */
const BUILD_FOR_NETWORK: Record<SimulatedNetwork, 'web' | 'meta'> = {
  'mraid-generic': 'web',
  meta: 'meta',
  google: 'web',
  mintegral: 'web',
  tiktok: 'web',
  liftoff: 'web',
  plain: 'web',
};

/**
 * The network id the runtime should pin, which is not the same string as the
 * simulator's key.
 *
 * The simulator groups the four MRAID networks under one "MRAID container"
 * entry; the runtime has one adapter per network and needs a real id. `unity` is
 * a stand-in for "a MRAID network" — all four want `mraid.open()`, so which one
 * is named changes nothing about what the playable does, and the detection caveat
 * is documented in `packages/adapters/src/networks.ts`.
 */
const RUNTIME_NETWORK: Record<SimulatedNetwork, string | null> = {
  'mraid-generic': 'unity',
  meta: 'meta',
  google: 'google',
  mintegral: 'mintegral',
  tiktok: 'tiktok',
  liftoff: 'liftoff',
  // No network injected at all: the runtime has to detect the absence and fall
  // back on its own, which is the behaviour worth testing.
  plain: null,
};

const state: {
  network: SimulatedNetwork;
  variant: string;
  log: BridgeLogEntry[];
  exit: string | null;
} = {
  network: 'mraid-generic',
  variant: 'a-instructional',
  log: [],
  exit: null,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function build(): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.replaceChildren();

  const networkSelect = el('select', 'select');
  for (const sim of Object.values(SIMULATIONS)) {
    const option = el('option');
    option.value = sim.id;
    option.textContent = sim.label;
    networkSelect.append(option);
  }
  networkSelect.value = state.network;

  const variantSelect = el('select', 'select');
  for (const variant of ['a-instructional', 'b-outcome']) {
    const option = el('option');
    option.value = variant;
    option.textContent = variant;
    variantSelect.append(option);
  }
  variantSelect.value = state.variant;

  const sim = SIMULATIONS[state.network];

  const header = el('header', 'header');
  header.append(
    el('h1', undefined, 'Симулятор Playble Ads'),
    el(
      'p',
      'subtitle',
      'Грузит собранный playable в фейковый контейнер сети и показывает каждый вызов SDK, который он делает.',
    ),
  );

  const controls = el('div', 'controls');
  const networkField = el('label', 'field');
  networkField.append(el('span', 'field-label', 'Сеть'), networkSelect);
  const variantField = el('label', 'field');
  variantField.append(el('span', 'field-label', 'Вариант хука'), variantSelect);
  const reloadButton = el('button', 'button', 'Перезагрузить юнит');
  controls.append(networkField, variantField, reloadButton);

  const note = el('p', 'note', `${sim.note} Хром снизу: ${sim.bottomChrome}px.`);

  const stage = el('div', 'stage');
  const frame = el('iframe', 'frame');
  frame.title = 'playable';
  // The chrome is what makes a low CTA visibly wrong, so it is drawn inside
  // the same box the network would occupy.
  frame.style.paddingBottom = `${sim.bottomChrome}px`;
  stage.append(frame);

  const chrome = el('div', 'chrome');
  chrome.textContent = `${sim.label} — хром ${sim.bottomChrome}px`;

  const logPanel = el('aside', 'log');
  const logTitle = el('h2', undefined, 'Вызовы SDK');
  const logList = el('ol', 'log-list');
  const exitBadge = el('p', 'exit-badge', 'выхода ещё не было');
  logPanel.append(logTitle, exitBadge, logList);

  function renderLog(): void {
    logList.replaceChildren();
    for (const entry of state.log) {
      const item = el('li');
      item.append(
        el('span', 'log-time', `${entry.at}ms`),
        el('span', 'log-api', entry.api),
        el('span', 'log-detail', entry.detail),
      );
      logList.append(item);
    }
    exitBadge.textContent = state.exit ? `выход через ${state.exit}` : 'выхода ещё не было';
    exitBadge.classList.toggle('exit-badge--ok', state.exit !== null);
  }

  function load(): void {
    state.log = [];
    state.exit = null;
    renderLog();

    const build = BUILD_FOR_NETWORK[state.network];
    const runtimeNetwork = RUNTIME_NETWORK[state.network];

    const params = new URLSearchParams({ variant: state.variant, debug: '1' });
    if (runtimeNetwork) params.set('network', runtimeNetwork);

    frame.src = `${PLAYABLE_SOURCES[build]}?${params.toString()}`;

    // The bridge has to be installed before the unit's first script runs, which
    // means the document has to already be same-origin when we can reach it.
    // Waiting for the load event is early enough and late enough.
    frame.addEventListener(
      'load',
      () => {
        try {
          const win = frame.contentWindow;
          if (!win) return;
          const bridge = createBridge(SIMULATIONS[state.network], (entry) => {
            state.log.push(entry);
            // The bridge knows when the playable asked for the store; the badge
            // reads from it rather than being tracked separately, so the two can
            // never disagree.
            state.exit = bridge.exitCall();
            renderLog();
          });
          bridge.install(win);
          state.exit = bridge.exitCall();
          renderLog();
        } catch (error) {
          state.log.push({ at: 0, api: 'simulator', detail: `не удалось достучаться до фрейма: ${String(error)}` });
          renderLog();
        }
      },
      { once: true },
    );
  }

  networkSelect.addEventListener('change', () => {
    state.network = networkSelect.value as SimulatedNetwork;
    const next = SIMULATIONS[state.network];
    frame.style.paddingBottom = `${next.bottomChrome}px`;
    note.textContent = `${next.note} Хром снизу: ${next.bottomChrome}px.`;
    chrome.textContent = `${next.label} — хром ${next.bottomChrome}px`;
    load();
  });

  variantSelect.addEventListener('change', () => {
    state.variant = variantSelect.value;
    load();
  });

  reloadButton.addEventListener('click', load);

  root.append(header, controls, note, el('div', 'main', ''));
  const main = root.querySelector('.main');
  if (main) main.append(stage, logPanel);

  // The chrome label sits over the space reserved for network UI.
  stage.append(chrome);

  renderLog();
  load();
}

build();
