import { mountPointerLockTest } from '../pointerlock';

const snapshot = mountPointerLockTest(document.getElementById('target') as HTMLElement);
const out = document.getElementById('result') as HTMLPreElement;
const render = (): void => {
  out.textContent = JSON.stringify(snapshot(), null, 2);
  requestAnimationFrame(render);
};
render();
