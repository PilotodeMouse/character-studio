// Controlador de play/stop/loop generico, reusado pelos dois modos
// (Craftpix e Template). Avanca um <input type=range> (em segundos) via
// requestAnimationFrame e chama onTick() a cada frame.
function createPlayback({ sliderEl, loopCheckboxEl, playButtonEl, getMax, onTick, getSpeed }) {
  let playing = false;
  let rafId = null;
  let lastTs = null;
  // O tempo corrente vive AQUI, nao no <input type=range>. O slider tem
  // step=0.01, e escrever nele quantiza o valor: em 0.25x cada frame avanca
  // ~0.004s e em 0.1x ~0.0016s, ambos abaixo do passo -- o valor voltava
  // arredondado pro mesmo lugar a cada frame e a animacao ficava congelada
  // (so 1x "funcionava", porque 0.016s/frame passa de 0.01). O slider agora
  // so exibe; quem manda no tempo e esta variavel.
  let time = parseFloat(sliderEl.value) || 0;

  function tick(ts) {
    if (!playing) return;
    if (lastTs === null) lastTs = ts;
    const speed = getSpeed ? getSpeed() : 1;
    const dt = ((ts - lastTs) / 1000) * speed;
    lastTs = ts;

    const max = getMax();
    time += dt;
    if (time > max) {
      if (loopCheckboxEl.checked) {
        time = max > 0 ? time % max : 0;
      } else {
        time = max;
        stop();
      }
    }
    sliderEl.value = time;
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
  // Arrastar o slider a mao vira a nova fonte do tempo (e pausa).
  sliderEl.addEventListener('input', () => {
    time = parseFloat(sliderEl.value) || 0;
    if (playing) stop();
  });

  return { play, stop, isPlaying: () => playing };
}

window.createPlayback = createPlayback;
