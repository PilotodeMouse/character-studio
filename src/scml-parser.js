// Parser de arquivos .scml (formato Spriter, usado pelos pacotes da Craftpix).
// Funciona tanto em Node (main process, via DOMParser polyfill abaixo) quanto
// no renderer do Electron (onde DOMParser ja existe nativamente).

function getDOMParser() {
  if (typeof DOMParser !== 'undefined') return DOMParser;
  // Fallback para uso em Node puro (fora do renderer do Electron).
  const { DOMParser: XmldomParser } = require('@xmldom/xmldom');
  return XmldomParser;
}

function num(el, attr, def = 0) {
  const v = el.getAttribute(attr);
  return v === null || v === undefined ? def : parseFloat(v);
}

function str(el, attr, def = '') {
  const v = el.getAttribute(attr);
  return v === null || v === undefined ? def : v;
}

function children(el, tag) {
  return Array.from(el.childNodes || []).filter(
    (n) => n.nodeType === 1 && n.tagName === tag
  );
}

function parseSCML(xmlText) {
  const Parser = getDOMParser();
  const doc = new Parser().parseFromString(xmlText, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'spriter_data') {
    throw new Error('Arquivo nao parece ser um .scml valido (raiz != spriter_data).');
  }

  // folders: id -> { id -> { name, width, height, pivotX, pivotY } }
  const folders = {};
  for (const folderEl of children(root, 'folder')) {
    const folderId = num(folderEl, 'id');
    const files = {};
    for (const fileEl of children(folderEl, 'file')) {
      const fileId = num(fileEl, 'id');
      files[fileId] = {
        name: str(fileEl, 'name'),
        width: num(fileEl, 'width'),
        height: num(fileEl, 'height'),
        pivotX: num(fileEl, 'pivot_x', 0),
        pivotY: num(fileEl, 'pivot_y', 1),
      };
    }
    folders[folderId] = files;
  }

  function resolveImage(folderId, fileId) {
    const f = folders[folderId];
    if (!f) throw new Error(`Folder ${folderId} nao encontrada no .scml`);
    const file = f[fileId];
    if (!file) throw new Error(`File ${fileId} nao encontrada na folder ${folderId}`);
    return file;
  }

  const entities = [];
  for (const entityEl of children(root, 'entity')) {
    const entity = {
      id: num(entityEl, 'id'),
      name: str(entityEl, 'name'),
      animations: [],
    };

    for (const animEl of children(entityEl, 'animation')) {
      const animation = {
        id: num(animEl, 'id'),
        name: str(animEl, 'name'),
        length: num(animEl, 'length'),
        interval: num(animEl, 'interval', 100),
        looping: str(animEl, 'looping', 'true') !== 'false',
        mainlineKeys: [],
        timelines: {}, // timelineId -> { name, objectType, keys: [] }
      };

      const mainlineEl = children(animEl, 'mainline')[0];
      if (mainlineEl) {
        for (const keyEl of children(mainlineEl, 'key')) {
          const key = {
            id: num(keyEl, 'id'),
            time: num(keyEl, 'time', 0),
            boneRefs: [],
            objectRefs: [],
          };
          for (const brEl of children(keyEl, 'bone_ref')) {
            key.boneRefs.push({
              id: num(brEl, 'id'),
              parent: num(brEl, 'parent', -1),
              timeline: num(brEl, 'timeline'),
              key: num(brEl, 'key'),
            });
          }
          for (const orEl of children(keyEl, 'object_ref')) {
            key.objectRefs.push({
              id: num(orEl, 'id'),
              parent: num(orEl, 'parent', -1),
              timeline: num(orEl, 'timeline'),
              key: num(orEl, 'key'),
              zIndex: num(orEl, 'z_index', 0),
            });
          }
          animation.mainlineKeys.push(key);
        }
      }

      for (const tlEl of children(animEl, 'timeline')) {
        const timelineId = num(tlEl, 'id');
        const objectType = str(tlEl, 'object_type', 'sprite');
        const keys = [];
        for (const keyEl of children(tlEl, 'key')) {
          const boneEl = children(keyEl, 'bone')[0];
          const objectEl = children(keyEl, 'object')[0];
          const src = boneEl || objectEl;
          const k = {
            id: num(keyEl, 'id'),
            time: num(keyEl, 'time', 0),
            spin: num(keyEl, 'spin', 1),
            curveType: str(keyEl, 'curve_type', 'linear'),
            x: src ? num(src, 'x', 0) : 0,
            y: src ? num(src, 'y', 0) : 0,
            angle: src ? num(src, 'angle', 0) : 0,
            scaleX: src ? num(src, 'scale_x', 1) : 1,
            scaleY: src ? num(src, 'scale_y', 1) : 1,
            alpha: src ? num(src, 'a', 1) : 1,
            isObject: !!objectEl,
          };
          if (objectEl) {
            k.folder = num(objectEl, 'folder');
            k.file = num(objectEl, 'file');
            k.pivotX = objectEl.getAttribute('pivot_x') !== null ? num(objectEl, 'pivot_x') : null;
            k.pivotY = objectEl.getAttribute('pivot_y') !== null ? num(objectEl, 'pivot_y') : null;
            const img = resolveImage(k.folder, k.file);
            k.imageName = img.name;
            k.imageWidth = img.width;
            k.imageHeight = img.height;
            if (k.pivotX === null) k.pivotX = img.pivotX;
            if (k.pivotY === null) k.pivotY = img.pivotY;
          }
          keys.push(k);
        }
        animation.timelines[timelineId] = { name: str(tlEl, 'name'), objectType, keys };
      }

      entity.animations.push(animation);
    }

    entities.push(entity);
  }

  return { folders, entities };
}

module.exports = { parseSCML };
