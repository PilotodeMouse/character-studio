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

// A ordem de desenho NAO e uma so por personagem: o Spriter deixa ela ser
// diferente em cada keyframe da timeline ("Spriter allows for the z-order of
// all images to be different at any point on the time-line", manual do Spriter
// Pro 1.4, capitulo "Adjusting the Z Order of Sprites"). getZIndexByPartName
// acima le so a primeira key da primeira animacao, o que serve de REFERENCIA
// (e o que a lista de camadas mostra) mas nao serve pra desenhar.
//
// Medido na biblioteca do usuario, 1916 animacoes de 106 personagens:
//  - 6 trocam a ordem NO MEIO da animacao -- Demons_of_Darkness_1 e _3 e Lich,
//    nos clips Slashing e Throwing: o braco direito sobe e passa na frente da
//    cabeca. Com uma ordem so, ele fica atras o clipe inteiro.
//  - 57 tem ordem fixa porem DIFERENTE da referencia -- sao os pacotes que
//    trazem as 4 vistas no proprio .scml (Front/Back/Left/Right), onde cada
//    vista tem a pilha dela.
//
// O caminho do .scml (src/scml-rig.js, mainlineKeyAt) ja fazia isso certo. Este
// indice leva a mesma coisa pro caminho do Unity, que e o principal.
function buildZOrderIndex(parsedScml) {
  const porAnimacao = new Map();
  const entity = parsedScml.entities[0];
  if (!entity) return porAnimacao;
  for (const anim of entity.animations) {
    const keys = anim.mainlineKeys
      .map((mkey) => {
        const zByName = new Map();
        for (const oref of mkey.objectRefs) {
          const timeline = anim.timelines[oref.timeline];
          if (timeline) zByName.set(timeline.name, oref.zIndex);
        }
        return { time: mkey.time, zByName };
      })
      .sort((a, b) => a.time - b.time);
    if (keys.length) porAnimacao.set(anim.name, keys);
  }
  return porAnimacao;
}

// Ordem vigente no instante t (SEGUNDOS -- o .scml guarda em ms, convertemos
// aqui, igual computeScmlPose faz). Em DEGRAU, nunca interpolada: entre uma
// ordem de camadas e outra nao existe meia ordem.
//
// `fallback` e usado quando a animacao nao aparece no .scml (nome de clip do
// Unity que nao casa com nome de animacao do Spriter) -- ai vale a referencia,
// que e exatamente o comportamento que havia antes.
function zIndexAt(index, animName, tSeconds, fallback) {
  const keys = index && index.get(animName);
  if (!keys || !keys.length) return fallback;
  const tMs = tSeconds * 1000;
  let atual = keys[0];
  for (const k of keys) {
    if (k.time <= tMs) atual = k;
    else break;
  }
  return atual.zByName;
}

module.exports = { getZIndexByPartName, buildZOrderIndex, zIndexAt };
