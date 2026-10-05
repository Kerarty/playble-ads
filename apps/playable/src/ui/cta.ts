/**
 * The install CTA.
 *
 * Lives in the DOM rather than on the canvas, and that is a deliberate choice.
 * A network overlay is an HTML element, so a canvas-drawn button underneath it
 * can be covered by something we cannot control; a real DOM button participates
 * in the same stacking order as the network's own chrome and can be positioned
 * above it. It also gets native focus, keyboard activation and a proper
 * accessible name for free.
 *
 * Placement is the part that matters. The button goes in the bottom third
 * (thumb reach on a phone held one-handed) but above whatever chrome the
 * network draws there, and the offset comes from the runtime's network profile
 * rather than being hard-coded.
 */

export interface CtaOptions {
  /** Bottom inset in design pixels that the network's chrome covers. */
  safeBottom: number;
  /** Copy. Networks and locales differ, so this is not baked in. */
  label: string;
  sublabel?: string;
  onTap: () => void;
}

export interface CtaHandle {
  show(): void;
  hide(): void;
  readonly visible: boolean;
  /** Called once per tap; the UI must not allow a double trigger. */
  dispose(): void;
}

export function createCta(root: HTMLElement, options: CtaOptions): CtaHandle {
  const wrapper = document.createElement('div');
  wrapper.className = 'playble-cta';
  wrapper.style.paddingBottom = `${options.safeBottom}px`;
  wrapper.hidden = true;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'playble-cta__button';
  button.textContent = options.label;
  // Networks reject a playable that is not navigable for assistive tech, and
  // this is free to get right.
  button.setAttribute('aria-label', options.sublabel ? `${options.label}. ${options.sublabel}` : options.label);

  if (options.sublabel) {
    const sub = document.createElement('span');
    sub.className = 'playble-cta__sub';
    sub.textContent = options.sublabel;
    button.append(sub);
  }

  let visible = false;
  let tapped = false;

  const onClick = (): void => {
    // Guard the double tap: two installs attributed from one impression would
    // corrupt the very metric this whole format is measured on.
    if (tapped) return;
    tapped = true;
    button.disabled = true;
    options.onTap();
  };

  button.addEventListener('click', onClick);
  wrapper.append(button);
  root.append(wrapper);

  return {
    show() {
      if (visible) return;
      visible = true;
      wrapper.hidden = false;
      // Restart the pulse animation: if the button was shown once and hidden,
      // re-adding the class is what makes the animation replay.
      button.classList.remove('playble-cta__button--in');
      void button.offsetWidth;
      button.classList.add('playble-cta__button--in');
    },
    hide() {
      visible = false;
      wrapper.hidden = true;
    },
    get visible() {
      return visible;
    },
    dispose() {
      button.removeEventListener('click', onClick);
      wrapper.remove();
    },
  };
}

/**
 * Copy overlay.
 *
 * Two short lines, never a paragraph. A playable that asks the player to read
 * loses them, and the research is consistent about it: anything that needs
 * reading is better served by video.
 */
export interface CopyHandle {
  show(text: string, sub?: string): void;
  hide(): void;
  /** Plays a short pop, used for positive beats. */
  celebrate(): void;
  dispose(): void;
}

export function createCopy(root: HTMLElement): CopyHandle {
  const wrapper = document.createElement('div');
  wrapper.className = 'playble-copy';
  wrapper.hidden = true;

  const title = document.createElement('h1');
  title.className = 'playble-copy__title';
  const sub = document.createElement('p');
  sub.className = 'playble-copy__sub';

  wrapper.append(title, sub);
  root.append(wrapper);

  return {
    show(text, subText) {
      title.textContent = text;
      sub.textContent = subText ?? '';
      sub.hidden = !subText;
      wrapper.hidden = false;
      wrapper.classList.remove('playble-copy--in');
      void wrapper.offsetWidth;
      wrapper.classList.add('playble-copy--in');
    },
    hide() {
      wrapper.hidden = true;
    },
    celebrate() {
      wrapper.classList.remove('playble-copy--pop');
      void wrapper.offsetWidth;
      wrapper.classList.add('playble-copy--pop');
    },
    dispose() {
      wrapper.remove();
    },
  };
}

/**
 * Small debug overlay, enabled with `?debug=1`.
 *
 * Shows the live frame rate and the funnel counters. This is the same data the
 * SDK reports, rendered locally, because the simulator needs to show what the
 * SDK saw without a network round trip.
 */
export interface DebugHandle {
  setText(text: string): void;
  dispose(): void;
}

export function createDebug(root: HTMLElement): DebugHandle {
  const panel = document.createElement('pre');
  panel.className = 'playble-debug';
  panel.hidden = true;
  root.append(panel);

  return {
    setText(text) {
      panel.textContent = text;
    },
    dispose() {
      panel.remove();
    },
  };
}
