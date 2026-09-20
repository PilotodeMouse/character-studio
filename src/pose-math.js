// Matematica de composicao de pose 2D (hierarquia pai->filho), compartilhada
// entre o renderer do rig do Unity (unity-skeleton.js) e o renderer do rig
// semantico de template (template-skeleton.js). Convencao: Y para cima,
// angulos em graus, sentido anti-horario positivo.
function identityTransform() {
  return { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1 };
}

function combine(parent, local) {
  const pr = (parent.angle * Math.PI) / 180;
  const cos = Math.cos(pr);
  const sin = Math.sin(pr);
  const sx = local.x * parent.scaleX;
  const sy = local.y * parent.scaleY;
  return {
    x: parent.x + (sx * cos - sy * sin),
    y: parent.y + (sx * sin + sy * cos),
    angle: parent.angle + local.angle,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
  };
}

// Inverso de combine: dado o transform de um pai e o de um filho no MUNDO,
// devolve o transform LOCAL do filho dentro do pai. Serve pra descobrir "como
// esta peca esta encaixada nesta mao" a partir de uma pose ja montada.
function relativeTo(parent, world) {
  const pr = (parent.angle * Math.PI) / 180;
  const cos = Math.cos(pr);
  const sin = Math.sin(pr);
  const dx = world.x - parent.x;
  const dy = world.y - parent.y;
  return {
    x: (dx * cos + dy * sin) / (parent.scaleX || 1),
    y: (-dx * sin + dy * cos) / (parent.scaleY || 1),
    angle: world.angle - parent.angle,
    scaleX: world.scaleX / (parent.scaleX || 1),
    scaleY: world.scaleY / (parent.scaleY || 1),
  };
}

module.exports = { identityTransform, combine, relativeTo };
