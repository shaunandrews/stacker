import type { World } from '@iwsdk/core';

// The splash screen (markup and styles in index.html): loading progress, then a
// choice between mixed reality and the mouse-and-keyboard desktop view. It comes
// back when you leave XR. Talks to the Stacker system through window events:
//   stacker:progress (detail 0–1) and stacker:ready  ← from the system
//   stacker:desktop (detail true/false)              → to the system

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function progress(fraction: number, label?: string): void {
  window.dispatchEvent(new CustomEvent('stacker:progress', { detail: { fraction, label } }));
}

export function initSplash(world: World): void {
  const splash = $('splash');
  const bar = $('splash-bar');
  const status = $('splash-status');
  const hud = $('hud');
  let xrSupported = false;

  const setDesktop = (on: boolean) => {
    document.body.classList.toggle('desktop', on);
    window.dispatchEvent(new CustomEvent('stacker:desktop', { detail: on }));
  };
  const show = (on: boolean) => splash.classList.toggle('hidden', !on);
  // Desktop mode switches off in sessionstart, so a failed request leaves it usable.
  const enterXR = () => world.launchXR();

  window.addEventListener('stacker:progress', (e) => {
    const { fraction, label } = (e as CustomEvent<{ fraction: number; label?: string }>).detail;
    bar.style.width = `${Math.round(fraction * 100)}%`;
    status.textContent = label ?? `Loading parts… ${Math.round(fraction * 100)}%`;
  });
  window.addEventListener('stacker:ready', () => splash.classList.add('ready'), { once: true });

  void navigator.xr
    ?.isSessionSupported('immersive-ar')
    .catch(() => false)
    .then((ok) => {
      xrSupported = !!ok;
      $('enter-xr').hidden = !ok;
      $('xr-note').hidden = !!ok;
      $('hud-xr').hidden = !ok;
    });
  if (!navigator.xr) {
    $('enter-xr').hidden = true;
    $('xr-note').hidden = false;
  }

  $('enter-xr').addEventListener('click', enterXR);
  $('hud-xr').addEventListener('click', enterXR);
  $('enter-desktop').addEventListener('click', () => {
    show(false);
    setDesktop(true);
  });
  $('hud-help').addEventListener('click', () => hud.classList.toggle('collapsed'));

  world.renderer.xr.addEventListener('sessionstart', () => {
    show(false);
    setDesktop(false);
  });
  world.renderer.xr.addEventListener('sessionend', () => {
    if (xrSupported || splash.classList.contains('ready')) show(true);
  });
}
