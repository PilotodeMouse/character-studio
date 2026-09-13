// Controlador de play/stop/loop generico, reusado pelos dois modos
// (Craftpix e Template). Avanca um <input type=range> (em segundos) via
// requestAnimationFrame e chama onTick() a cada frame.
function createPlayback({ sliderEl, loopCheckboxEl, playButtonEl, getMax, onTick }) {
  let playing = false;
  let rafId = null;
  let lastTs = null;

  function tick(ts) {
    if (!playing) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    const max = getMax();
    let v = parseFloat(sliderEl.value) + dt;
    if (v > max) {
      if (loopCheckboxEl.checked) {
        v = max > 0 ? v % max : 0;
      } else {
        v = max;
        stop();
      }
    }
    sliderEl.value = v;
    onTick();
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    playing = true;
    lastTs = null;
    playButtonEl.innerHTML = '&#9632; Stop';
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    playButtonEl.innerHTML = '&#9654; Play';
  }

  playButtonEl.addEventListener('click', () => (playing ? stop() : play()));
  sliderEl.addEventListener('input', () => {
    if (playing) stop();
  });

  return { play, stop, isPlaying: () => playing };
}

window.createPlayback = createPlayback;
