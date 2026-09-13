// Parser minimo para arquivos .asset serializados pelo Unity em YAML texto
// (o formato usado dentro de .unitypackage quando exportado com "Force Text").
// Unity concatena varios "documentos" YAML num unico arquivo, cada um
// prefixado por uma tag propria (`--- !u!<classId> &<fileId>`) que nao e
// YAML padrao. Em vez de ensinar um parser YAML genérico a entender essa tag,
// separamos os documentos manualmente e mandamos so o corpo (YAML valido)
// para o js-yaml.
const yaml = require('js-yaml');

const DOC_HEADER_RE = /^--- !u!(\d+) &(-?\d+)(?:\s+stripped)?\s*$/;

// Retorna um Map<fileId (string), { classId, key, data }>, onde `key` e o
// nome do tipo (ex: "GameObject", "Transform", "AnimationClip") e `data` e o
// objeto correspondente aquele tipo (js-yaml da um wrapper {TypeName: {...}}).
function parseUnityYaml(text) {
  const lines = text.split(/\r?\n/);
  const docs = new Map();

  let currentHeader = null;
  let bodyLines = [];

  function flush() {
    if (!currentHeader) return;
    // fileID sao ids de 64 bits (ex: 212258337060216878) -- maiores que
    // Number.MAX_SAFE_INTEGER. Se deixarmos o js-yaml interpretar como
    // number, ele arredonda e todas as referencias entre objetos quebram
    // silenciosamente. Forcamos string antes do parse.
    const body = bodyLines.join('\n').replace(/fileID: (-?\d+)/g, 'fileID: "$1"');
    let parsed;
    try {
      parsed = yaml.load(body);
    } catch (err) {
      // Unity as vezes emite floats como "inf"/"-inf"/"nan" ou outras
      // esquisitices que o js-yaml recusa; um documento que falha e raro
      // (geralmente lixo de editor) e nao deve derrubar o resto do parse.
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      const key = Object.keys(parsed)[0];
      docs.set(currentHeader.fileId, { classId: currentHeader.classId, key, data: parsed[key] });
    }
    bodyLines = [];
  }

  for (const line of lines) {
    if (line.startsWith('%YAML') || line.startsWith('%TAG')) continue;
    const m = DOC_HEADER_RE.exec(line);
    if (m) {
      flush();
      currentHeader = { classId: parseInt(m[1], 10), fileId: m[2] };
      continue;
    }
    bodyLines.push(line);
  }
  flush();

  return docs;
}

module.exports = { parseUnityYaml };
