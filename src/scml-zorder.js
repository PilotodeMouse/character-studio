// A ordem de desenho (z_index) do Unity prefab vem toda zerada nesses
// pacotes (m_SortingOrder=0 pra tudo), entao a camada de cada parte tem que
// vir de outro lugar: a mainline do proprio .scml, que registra o z_index
// original de cada object_ref. Extraimos isso da primeira key da primeira
// animation (normalmente "Base", que e so a pose de referencia mas usa a
// mesma pilha de camadas de todas as outras).
function getZIndexByPartName(parsedScml) {
  const zByName = new Map();
  const entity = parsedScml.entities[0];
  const anim = entity.animations[0];
  const mkey = anim.mainlineKeys[0];
  for (const oref of mkey.objectRefs) {
    const timeline = anim.timelines[oref.timeline];
    zByName.set(timeline.name, oref.zIndex);
  }
  return zByName;
}

module.exports = { getZIndexByPartName };
