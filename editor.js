(() => {
  "use strict";
  const WORLD_WIDTH = 2400;
  const WORLD_HEIGHT = 1620;
  const BLOCKS = {
    h: { width: 240, height: 60 },
    v: { width: 240, height: 60, rot: 90 }
  };
  const HANDLE_OFFSET_PX = 30;
  const SNAP_FINE = 5;
  const SNAP_COARSE = 30;
  const ROT_SNAP_FINE = 1;
  const ROT_SNAP_COARSE = 15;
  const REACH_CELL = 30;
  const MIN_PLAYABLE_CELLS = 16;
  const STORAGE_KEY = "star-ring-custom-maps";

  function distToRect(x, y, rect) {
    if (!rect.rot) {
      const nearestX = x < rect.x ? rect.x : x > rect.x + rect.width ? rect.x + rect.width : x;
      const nearestY = y < rect.y ? rect.y : y > rect.y + rect.height ? rect.y + rect.height : y;
      return Math.hypot(x - nearestX, y - nearestY);
    }
    const hw = rect.width / 2;
    const hh = rect.height / 2;
    const dx = x - (rect.x + hw);
    const dy = y - (rect.y + hh);
    const rad = rect.rot * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const nearestLX = lx < -hw ? -hw : lx > hw ? hw : lx;
    const nearestLY = ly < -hh ? -hh : ly > hh ? hh : ly;
    return Math.hypot(lx - nearestLX, ly - nearestLY);
  }

  const byId = (id) => document.getElementById(id);
  const els = {
    overlay: byId("editor-overlay"),
    canvas: byId("editor-canvas"),
    exit: byId("editor-exit-btn"),
    save: byId("editor-save-btn"),
    tools: byId("editor-tools"),
    undo: byId("editor-undo-btn"),
    redo: byId("editor-redo-btn"),
    materials: byId("editor-materials"),
    selectOverlay: byId("custom-select-overlay"),
    cards: byId("custom-map-cards"),
    empty: byId("custom-empty"),
    startBtn: byId("custom-select-start-btn"),
    back: byId("custom-select-back-btn"),
    createBtn: byId("custom-create-btn"),
    importBtn: byId("custom-import-btn"),
    randomEntry: byId("custom-random-entry"),
    dialog: byId("editor-dialog-overlay"),
    dialogPanel: byId("editor-dialog-panel"),
    dialogEyebrow: byId("editor-dialog-eyebrow"),
    dialogTitle: byId("editor-dialog-title"),
    dialogText: byId("editor-dialog-text"),
    dialogInput: byId("editor-dialog-input"),
    descInput: byId("editor-dialog-desc-input"),
    code: byId("editor-dialog-code"),
    dialogActions: byId("editor-dialog-actions")
  };

  function loadMaps() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved)
        ? saved
            .filter((entry) => entry && typeof entry === "object" && entry.id && typeof entry.name === "string")
            .map((entry) => ({ ...entry, desc: typeof entry.desc === "string" && entry.desc !== "undefined" ? entry.desc : "" }))
        : [];
    } catch {
      return [];
    }
  }

  function saveMaps(maps) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
    } catch {}
  }

  let toastTimer = 0;
  function toast(message, color = "#64fbd2") {
    const element = byId("powerup-toast");
    element.textContent = message;
    element.style.color = color;
    element.style.borderColor = color;
    element.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      element.hidden = true;
    }, 2200);
  }

  const clampNum = (value, min, max) => Math.min(max, Math.max(min, value));
  const CODE_PREFIX = "SRB2.";
  const CODE_KEY = [0x5a, 0xa5, 0x3c, 0xc3];

  function checksum16(bytes) {
    let hash = 0x811c;
    for (const byte of bytes) {
      hash ^= byte;
      hash = (hash * 0x01000193) & 0xffff;
    }
    return hash;
  }

  function encodeMapCode(entry) {
    const writer = { bits: [] };
    const push = (value, count) => {
      for (let i = count - 1; i >= 0; i -= 1) writer.bits.push((value >> i) & 1);
    };
    const nameBytes = Array.from(new TextEncoder().encode(entry.name).slice(0, 255));
    const descBytes = Array.from(new TextEncoder().encode(typeof entry.desc === "string" ? entry.desc : "").slice(0, 255));
    push(nameBytes.length, 8);
    for (const byte of nameBytes) push(byte, 8);
    push(descBytes.length, 8);
    for (const byte of descBytes) push(byte, 8);
    const blocks = (entry.blocks || []).slice(0, 255);
    push(blocks.length, 8);
    for (const block of blocks) {
      push(Math.round((clampNum(Number(block.x) || 0, -90, 2400) + 90) / 5), 9);
      push(Math.round(clampNum(Number(block.y) || 0, 0, 1620) / 5), 9);
      push(Math.round(clampNum(Number(block.width) || 0, 0, 2400) / 5), 9);
      push(Math.round(clampNum(Number(block.height) || 0, 0, 1620) / 5), 9);
      push(((Math.round((Number(block.rot) || 0) / 15) % 24) + 24) % 24, 5);
    }
    const data = [];
    for (let i = 0; i < writer.bits.length; i += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b += 1) byte = (byte << 1) | (writer.bits[i + b] || 0);
      data.push(byte);
    }
    const hash = checksum16(data);
    const bytes = [...data, hash >> 8, hash & 0xff].map((byte, index) => byte ^ CODE_KEY[index % CODE_KEY.length]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return CODE_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeMapCode(code) {
    if (typeof code !== "string") return null;
    const trimmed = code.trim();
    if (!trimmed.startsWith(CODE_PREFIX)) return null;
    let binary = "";
    try {
      binary = atob(trimmed.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return null;
    }
    const bytes = [];
    for (let i = 0; i < binary.length; i += 1) bytes.push(binary.charCodeAt(i) ^ CODE_KEY[i % CODE_KEY.length]);
    if (bytes.length < 3) return null;
    const data = bytes.slice(0, -2);
    const hash = checksum16(data);
    if (hash !== ((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1])) return null;
    const bits = [];
    for (const byte of data) {
      for (let b = 7; b >= 0; b -= 1) bits.push((byte >> b) & 1);
    }
    let pos = 0;
    const read = (count) => {
      if (pos + count > bits.length) return null;
      let value = 0;
      for (let i = 0; i < count; i += 1) value = (value << 1) | bits[pos + i];
      pos += count;
      return value;
    };
    const readChunk = () => {
      const length = read(8);
      if (length === null) return null;
      const chunk = [];
      for (let i = 0; i < length; i += 1) {
        const byte = read(8);
        if (byte === null) return null;
        chunk.push(byte);
      }
      return chunk;
    };
    const nameBytes = readChunk();
    const descBytes = readChunk();
    const blockCount = read(8);
    if (nameBytes === null || descBytes === null || blockCount === null) return null;
    let name = "";
    let desc = "";
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      name = decoder.decode(Uint8Array.from(nameBytes)).trim();
      desc = decoder.decode(Uint8Array.from(descBytes));
    } catch {
      return null;
    }
    if (!name) return null;
    if (blockCount < 1 || blockCount > 255) return null;
    const blocks = [];
    for (let i = 0; i < blockCount; i += 1) {
      const qx = read(9);
      const qy = read(9);
      const qw = read(9);
      const qh = read(9);
      const rot = read(5);
      if (qx === null || qy === null || qw === null || qh === null || rot === null) return null;
      if (qx > 498 || qy > 324 || qw > 480 || qh > 324 || qw < 1 || qh < 1) return null;
      blocks.push({ x: qx * 5 - 90, y: qy * 5, width: qw * 5, height: qh * 5, rot: rot * 15 });
    }
    return { name, desc, blocks };
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    area.remove();
    return ok;
  }

  function newMapId() {
    return `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function uniqueName(name, excludeId = null) {
    const maps = loadMaps();
    const base = name.trim();
    const taken = (candidate) => maps.some((entry) => entry.id !== excludeId && entry.name === candidate);
    if (!taken(base)) return base;
    const numbered = base.match(/^(.*?)\s*(\d+)$/);
    if (numbered && numbered[1].trim()) {
      const stem = numbered[1].trim();
      let n = Number(numbered[2]);
      while (taken(`${stem} ${n}`)) n += 1;
      return `${stem} ${n}`;
    }
    let n = 2;
    while (taken(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  class MapEditor {
    constructor() {
      this.editorOpen = false;
      this.selectOpen = false;
      this.blocks = [];
      this.nextBlockId = 1;
      this.tool = "place";
      this.material = "h";
      this.selected = null;
      this.group = [];
      this.groupBounds = null;
      this.lastPlaced = null;
      this.past = [];
      this.future = [];
      this.dirty = false;
      this.customSelectedId = null;
      this.detailMapId = null;
      this.editingMapId = null;
      this.editorFromSelect = false;
      this.ctrlHeld = false;
      this.pointer = { x: -1, y: -1, inside: false };
      this.drag = null;
      this.dialogResolver = null;
      this.context = els.canvas.getContext("2d");
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.raf = 0;
      this.bind();
      window.addEventListener("resize", () => {
        if (this.editorOpen) this.resize();
      });
    }

    bind() {
      els.exit.addEventListener("click", () => this.requestExit());
      els.save.addEventListener("click", () => this.saveFlow(true));
      els.tools.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-act]");
        if (actionButton) {
          if (actionButton.dataset.act === "undo") this.undo();
          else if (actionButton.dataset.act === "redo") this.redo();
          return;
        }
        const button = event.target.closest("[data-tool]");
        if (!button) return;
        this.setTool(button.dataset.tool);
      });
      els.materials.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mat]");
        if (!button) return;
        this.setMaterial(button.dataset.mat);
      });
      els.back.addEventListener("click", () => this.closeSelect());
      els.startBtn.addEventListener("click", () => this.startSelected());
      els.createBtn.addEventListener("click", () => this.openCreateMap());
      els.importBtn.addEventListener("click", () => this.importMap());
      els.randomEntry.addEventListener("click", () => this.selectCustomRandom());
      els.dialog.addEventListener("click", (event) => {
        if (event.target === els.dialog) this.resolveDialog(null);
      });
      els.dialogInput.addEventListener("keydown", (event) => {
        if ((event.code === "Enter" || event.code === "NumpadEnter") && !event.isComposing && !els.dialog.hidden) {
          event.preventDefault();
          const primary = els.dialogActions.querySelector(".primary-btn");
          if (primary && !primary.disabled) primary.click();
        }
      });
      els.descInput.addEventListener("keydown", (event) => {
        if ((event.code === "Enter" || event.code === "NumpadEnter") && !event.isComposing && !els.dialog.hidden) {
          event.preventDefault();
          const primary = els.dialogActions.querySelector(".primary-btn");
          if (primary && !primary.disabled) primary.click();
        }
      });
      els.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
      els.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
      els.canvas.addEventListener("pointerup", () => this.onPointerUp());
      els.canvas.addEventListener("pointercancel", () => this.onPointerUp());
      els.canvas.addEventListener("pointerleave", () => {
        this.pointer.inside = false;
      });
      window.addEventListener("keydown", (event) => {
        if (!this.editorOpen) return;
        if (!els.dialog.hidden) {
          if (event.code === "Escape") {
            event.preventDefault();
            this.resolveDialog(null);
          }
          return;
        }
        if (event.code === "Escape") {
          event.preventDefault();
          this.requestExit();
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.code === "MetaLeft" || event.code === "MetaRight") this.ctrlHeld = true;
      });
      window.addEventListener("keyup", (event) => {
        if (event.code === "MetaLeft" || event.code === "MetaRight") this.ctrlHeld = false;
      });
      window.addEventListener("blur", () => {
        this.ctrlHeld = false;
      });
    }

    // ---------- 编辑器开关 ----------
    openEditor(existingMap = null) {
      if (this.editorOpen || this.selectOpen) return;
      this.editorOpen = true;
      this.blocks = (existingMap ? existingMap.blocks : []).map((block, index) => ({ ...block, id: index + 1 }));
      this.nextBlockId = this.blocks.length + 1;
      this.editingMapId = existingMap ? existingMap.id : null;
      this.editorFromSelect = !!existingMap;
      this.selected = null;
      this.group = [];
      this.groupBounds = null;
      this.lastPlaced = null;
      this.past = [];
      this.future = [];
      this.dirty = false;
      this.drag = null;
      this.setTool("place");
      els.overlay.hidden = false;
      this.resize();
      this.startLoop();
      this.updateToolUI();
    }

    closeEditor() {
      this.editorOpen = false;
      this.editingMapId = null;
      els.overlay.hidden = true;
      window.cancelAnimationFrame(this.raf);
    }

    closeAll() {
      this.resolveDialog(null);
      this.closeEditor();
      this.closeSelect();
    }

    // ---------- 自制星域选择界面 ----------
    openSelect() {
      game.reloadCustomMaps();
      game.renderModeUI();
      this.detailMapId = this.customSelectedId;
      this.renderCards();
      this.selectOpen = true;
      els.selectOverlay.hidden = false;
    }

    closeSelect() {
      this.selectOpen = false;
      els.selectOverlay.hidden = true;
    }

    renderCards() {
      game.reloadCustomMaps();
      const maps = game.customMaps;
      if (!maps.some((map) => map.id === this.customSelectedId)) {
        this.customSelectedId = maps.length ? maps[0].id : null;
      }
      if (this.detailMapId !== "random" && !maps.some((map) => map.id === this.detailMapId)) {
        this.detailMapId = this.customSelectedId;
      }
      els.cards.replaceChildren();
      els.empty.hidden = maps.length > 0;
      for (const map of maps) {
        const card = document.createElement("div");
        card.className = `map-card custom-map-card${map.id === this.customSelectedId ? " selected" : ""}${map.id === this.detailMapId ? " detail" : ""}`;
        card.style.setProperty("--swatch", "#64fbd2");
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", String(map.id === this.customSelectedId));
        card.tabIndex = 0;
        card.innerHTML = `<span class="card-face"><span class="map-swatch"></span><strong></strong><p></p><span class="card-actions"><button type="button" class="card-btn" data-act="share">${I18N.t("customSelect.share")}</button><button type="button" class="card-btn" data-act="edit">${I18N.t("customSelect.edit")}</button><button type="button" class="card-btn" data-act="rename">${I18N.t("customSelect.rename")}</button><button type="button" class="card-btn danger" data-act="delete">${I18N.t("customSelect.delete")}</button></span></span>`;
        card.querySelector(".card-face strong").textContent = map.name;
        card.querySelector(".card-face p").textContent = map.desc || I18N.t("customSelect.blocks", { n: map.blocks.length });
        const detail = document.createElement("span");
        detail.className = "card-detail";
        detail.innerHTML = `<span class="detail-left"><strong class="detail-title"></strong><span class="detail-actions"><button type="button" class="card-btn" data-act="share">${I18N.t("customSelect.share")}</button><button type="button" class="card-btn" data-act="edit">${I18N.t("customSelect.edit")}</button><button type="button" class="card-btn" data-act="rename">${I18N.t("customSelect.rename")}</button><button type="button" class="card-btn danger" data-act="delete">${I18N.t("customSelect.delete")}</button></span></span>`;
        detail.querySelector(".detail-title").textContent = map.name;
        const canvas = document.createElement("canvas");
        canvas.className = "detail-preview";
        canvas.width = 192;
        canvas.height = 128;
        window.mapPreview.drawCustom(canvas, map.blocks);
        const previewBox = document.createElement("span");
        previewBox.className = "detail-right";
        previewBox.appendChild(canvas);
        detail.appendChild(previewBox);
        card.appendChild(detail);
        card.addEventListener("click", (event) => {
          const action = event.target.closest("[data-act]");
          if (action) {
            event.stopPropagation();
            if (action.dataset.act === "share") this.shareMap(map.id);
            else if (action.dataset.act === "edit") this.editMap(map.id);
            else if (action.dataset.act === "rename") this.renameMap(map.id);
            else this.deleteMap(map.id);
            return;
          }
          this.selectCustom(map.id);
        });
        card.addEventListener("keydown", (event) => {
          if (event.code === "Enter" || event.code === "Space") {
            event.preventDefault();
            this.selectCustom(map.id);
          }
        });
        els.cards.appendChild(card);
      }
      els.startBtn.disabled = !this.customSelectedId;
    }

    selectCustomRandom() {
      const maps = game.customMaps;
      if (!maps.length) return;
      this.customSelectedId = maps[Math.floor(Math.random() * maps.length)].id;
      this.detailMapId = this.customSelectedId;
      game.audio.tone(480, 0.08, "sine", 0.018, 720);
      this.renderCards();
    }

    selectCustom(id) {
      if (!game.customMaps.some((map) => map.id === id)) return;
      this.customSelectedId = id;
      this.detailMapId = id;
      game.audio.tone(480, 0.08, "sine", 0.018, 720);
      this.renderCards();
    }

    startSelected() {
      if (!this.customSelectedId) return;
      const result = game.startCustomRun(this.customSelectedId);
      if (result === "disabled") {
        toast(I18N.t("custom.blockedText"), "#ff9dab");
        return;
      }
      if (result) this.closeSelect();
    }

    editMap(id) {
      const map = loadMaps().find((entry) => entry.id === id);
      if (!map) return;
      this.closeSelect();
      this.openEditor(map);
    }

    openCreateMap() {
      this.closeSelect();
      this.openEditor();
      this.editorFromSelect = true;
    }

    async importMap() {
      let lastValue = "";
      for (;;) {
        const choice = await this.showDialog({
          eyebrow: "CUSTOM SECTOR",
          title: I18N.t("custom.importTitle"),
          text: I18N.t("custom.importHint"),
          input: { value: lastValue, placeholder: I18N.t("custom.importPlaceholder"), maxlength: 5000, multiline: true },
          buttons: [
            { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
            { label: I18N.t("custom.importConfirm"), value: "import", className: "primary-btn" }
          ]
        });
        if (choice !== "import") return;
        lastValue = els.code.value.trim();
        const decoded = decodeMapCode(lastValue);
        if (!decoded) {
          toast(I18N.t("custom.importInvalid"), "#ff9dab");
          continue;
        }
        const maps = loadMaps();
        maps.push({ id: newMapId(), name: uniqueName(decoded.name), desc: decoded.desc, blocks: decoded.blocks, createdAt: Date.now() });
        saveMaps(maps);
        game.reloadCustomMaps();
        this.renderCards();
        toast(I18N.t("custom.imported", { name: decoded.name }));
        return;
      }
    }

    async shareMap(id) {
      const map = loadMaps().find((entry) => entry.id === id);
      if (!map) return;
      const code = encodeMapCode(map);
      const choice = await this.showDialog({
        eyebrow: "CUSTOM SECTOR",
        title: I18N.t("custom.shareTitle"),
        text: I18N.t("custom.shareHint"),
        input: { value: code, placeholder: "", readonly: true, maxlength: 10000, multiline: true },
        buttons: [
          { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
          { label: I18N.t("custom.copy"), value: "copy", className: "primary-btn" }
        ]
      });
      if (choice !== "copy") return;
      const ok = await copyText(code);
      toast(ok ? I18N.t("custom.copied") : I18N.t("custom.copyFailed"), ok ? "#64fbd2" : "#ff9dab");
    }

    async renameMap(id) {
      const maps = loadMaps();
      const map = maps.find((entry) => entry.id === id);
      if (!map) return;
      const choice = await this.showDialog({
        eyebrow: "CUSTOM SECTOR",
        title: I18N.t("custom.renameTitle"),
        input: { value: map.name, placeholder: I18N.t("custom.namePlaceholder") },
        input2: { value: typeof map.desc === "string" ? map.desc : "", placeholder: I18N.t("custom.descPlaceholder") },
        buttons: [
          { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
          { label: I18N.t("custom.confirm"), value: "save", className: "primary-btn" }
        ]
      });
      if (choice !== "save") return;
      const name = els.dialogInput.value.trim();
      if (!name) return;
      map.name = uniqueName(name, map.id);
      map.desc = els.descInput.value.trim();
      saveMaps(maps);
      game.reloadCustomMaps();
      this.renderCards();
      toast(I18N.t("custom.renamedTo", { name: map.name }));
    }

    async deleteMap(id) {
      const maps = loadMaps();
      const map = maps.find((entry) => entry.id === id);
      if (!map) return;
      const choice = await this.showDialog({
        eyebrow: "CUSTOM SECTOR",
        title: I18N.t("custom.deleteTitle"),
        text: I18N.t("custom.deleteText", { name: map.name }),
        buttons: [
          { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
          { label: I18N.t("custom.delete"), value: "delete", className: "danger-btn" }
        ]
      });
      if (choice !== "delete") return;
      saveMaps(maps.filter((entry) => entry.id !== id));
      game.reloadCustomMaps();
      this.renderCards();
      toast(I18N.t("custom.deleted"), "#ff9dab");
    }

    // ---------- 退出 / 保存流程 ----------
    async requestExit() {
      if (!this.dirty) {
        this.closeEditor();
        if (this.editorFromSelect) this.openSelect();
        return;
      }
      const choice = await this.showDialog({
        eyebrow: "CUSTOM SECTOR",
        title: I18N.t("custom.unsavedTitle"),
        text: I18N.t("custom.unsavedText"),
        buttons: [
          { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
          { label: I18N.t("custom.discard"), value: "discard", className: "secondary-btn" },
          { label: I18N.t("custom.confirm"), value: "save", className: "primary-btn" }
        ]
      });
      if (choice === "discard") {
        this.closeEditor();
        if (this.editorFromSelect) this.openSelect();
      } else if (choice === "save") {
        const saved = await this.saveFlow(false);
        if (saved) {
          this.closeEditor();
          this.openSelect();
        }
      }
    }

    checkPlayable() {
      const cols = Math.ceil(WORLD_WIDTH / REACH_CELL);
      const rows = Math.ceil(WORLD_HEIGHT / REACH_CELL);
      const total = cols * rows;
      const obstacles = this.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height, rot: block.rot || 0 }));
      const blocked = new Uint8Array(total);
      for (let idx = 0; idx < total; idx += 1) {
        const x = (idx % cols) * REACH_CELL + REACH_CELL / 2;
        const y = ((idx / cols) | 0) * REACH_CELL + REACH_CELL / 2;
        if (x > WORLD_WIDTH || y > WORLD_HEIGHT || obstacles.some((obstacle) => distToRect(x, y, obstacle) < 1)) blocked[idx] = 1;
      }
      const label = new Int16Array(total).fill(-1);
      const queue = [];
      let bestLabel = -1;
      let bestSize = 0;
      let nextLabel = 0;
      for (let start = 0; start < total; start += 1) {
        if (blocked[start] || label[start] !== -1) continue;
        let size = 0;
        label[start] = nextLabel;
        queue.push(start);
        while (queue.length) {
          const idx = queue.pop();
          size += 1;
          if (idx % cols > 0 && !blocked[idx - 1] && label[idx - 1] === -1) { label[idx - 1] = nextLabel; queue.push(idx - 1); }
          if (idx % cols < cols - 1 && !blocked[idx + 1] && label[idx + 1] === -1) { label[idx + 1] = nextLabel; queue.push(idx + 1); }
          if (idx - cols >= 0 && !blocked[idx - cols] && label[idx - cols] === -1) { label[idx - cols] = nextLabel; queue.push(idx - cols); }
          if (idx + cols < total && !blocked[idx + cols] && label[idx + cols] === -1) { label[idx + cols] = nextLabel; queue.push(idx + cols); }
        }
        if (size > bestSize) { bestSize = size; bestLabel = nextLabel; }
        nextLabel += 1;
      }
      if (bestSize < MIN_PLAYABLE_CELLS) return false;
      for (let idx = 0; idx < total; idx += 1) {
        if (label[idx] !== bestLabel) continue;
        const x = (idx % cols) * REACH_CELL + REACH_CELL / 2;
        const y = ((idx / cols) | 0) * REACH_CELL + REACH_CELL / 2;
        if (x > WORLD_WIDTH || y > WORLD_HEIGHT) continue;
        if (obstacles.every((obstacle) => distToRect(x, y, obstacle) >= 24)) return true;
      }
      return false;
    }

    checkBossSpace() {
      const obstacles = this.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height, rot: block.rot || 0 }));
      const cols = Math.ceil(WORLD_WIDTH / REACH_CELL);
      const rows = Math.ceil(WORLD_HEIGHT / REACH_CELL);
      const total = cols * rows;
      const MIN_BOSS_CLEARANCE = 60;
      const sampleOffsets = [-10, 0, 10];
      for (let idx = 0; idx < total; idx += 1) {
        const cx = (idx % cols) * REACH_CELL + REACH_CELL / 2;
        const cy = ((idx / cols) | 0) * REACH_CELL + REACH_CELL / 2;
        if (cx > WORLD_WIDTH || cy > WORLD_HEIGHT) continue;
        let clear = true;
        sampleLoop: for (let sx = 0; sx < 3; sx += 1) {
          for (let sy = 0; sy < 3; sy += 1) {
            const x = cx + sampleOffsets[sx];
            const y = cy + sampleOffsets[sy];
            if (obstacles.some((obstacle) => distToRect(x, y, obstacle) < MIN_BOSS_CLEARANCE)) { clear = false; break sampleLoop; }
          }
        }
        if (clear) return true;
      }
      return false;
    }

    async saveFlow(fromButton) {
      if (!this.blocks.length) {
        toast(I18N.t("custom.needBlocks"), "#ff9dab");
        return false;
      }
      if (!this.checkPlayable()) {
        toast(I18N.t("custom.noSpawn"), "#ff9dab");
        return false;
      }
      if (!this.checkBossSpace()) {
        toast(I18N.t("custom.noBoss"), "#ff9dab");
        return false;
      }
      const maps = loadMaps();
      const existing = this.editingMapId ? maps.find((entry) => entry.id === this.editingMapId) : null;
      const blocks = this.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height, rot: block.rot || 0 }));
      if (existing) {
        existing.blocks = blocks;
        existing.updatedAt = Date.now();
      } else {
        const choice = await this.showDialog({
          eyebrow: "CUSTOM SECTOR",
          title: I18N.t("custom.nameTitle"),
          input: { value: this.suggestName(), placeholder: I18N.t("custom.namePlaceholder") },
          input2: { placeholder: I18N.t("custom.descPlaceholder") },
          buttons: [
            { label: I18N.t("custom.cancel"), value: null, className: "secondary-btn" },
            { label: I18N.t("custom.confirm"), value: "save", className: "primary-btn" }
          ]
        });
        if (choice !== "save") return false;
        const name = els.dialogInput.value.trim();
        if (!name) return false;
        const desc = els.descInput.value.trim();
        const id = newMapId();
        maps.push({ id, name: uniqueName(name), desc, blocks, createdAt: Date.now() });
        this.editingMapId = id;
        this.customSelectedId = id;
      }
      saveMaps(maps);
      game.reloadCustomMaps();
      this.dirty = false;
      if (fromButton) toast(I18N.t("custom.saved"));
      return true;
    }

    suggestName() {
      const count = loadMaps().length + 1;
      return I18N.t("custom.nameSuggestion", { n: count });
    }

    // ---------- 通用对话框 ----------
    showDialog({ eyebrow, title, text = "", input = null, input2 = null, buttons }) {
      if (this.dialogResolver) this.dialogResolver(null);
      return new Promise((resolve) => {
        this.dialogResolver = resolve;
        els.dialogEyebrow.textContent = eyebrow;
        els.dialogTitle.textContent = title;
        els.dialogText.hidden = !text;
        els.dialogText.textContent = text;
        const multiline = !!(input && input.multiline);
        els.dialogPanel.classList.toggle("map-code-dialog", multiline);
        const field = multiline ? els.code : els.dialogInput;
        (multiline ? els.dialogInput : els.code).hidden = true;
        els.descInput.hidden = !input2;
        els.descInput.value = input2 && input2.value != null ? input2.value : "";
        els.descInput.placeholder = input2 ? input2.placeholder || "" : "";
        field.hidden = !input;
        field.value = input && input.value != null ? input.value : "";
        field.placeholder = input ? input.placeholder || "" : "";
        field.readOnly = !!(input && input.readonly);
        field.maxLength = Math.max(0, input && input.maxlength != null ? input.maxlength : 16);
        els.dialogActions.replaceChildren();
        for (const definition of buttons) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = definition.className || "secondary-btn";
          button.textContent = definition.label;
          button.addEventListener("click", () => this.resolveDialog(definition.value));
          els.dialogActions.appendChild(button);
        }
        if (input) {
          field.oninput = () => {
            const primary = els.dialogActions.querySelector(".primary-btn");
            if (primary) primary.disabled = !field.value.trim();
          };
          field.oninput();
        }
        els.dialog.hidden = false;
        if (input) {
          window.setTimeout(() => {
            field.focus();
            field.select();
          }, 30);
        }
      });
    }

    resolveDialog(value) {
      els.dialog.hidden = true;
      els.dialogInput.oninput = null;
      els.code.oninput = null;
      els.descInput.oninput = null;
      els.dialogPanel.classList.remove("map-code-dialog");
      if (this.dialogResolver) {
        const resolver = this.dialogResolver;
        this.dialogResolver = null;
        resolver(value);
      }
    }

    // ---------- 工具 ----------
    setTool(tool) {
      this.tool = tool;
      this.drag = null;
      if (tool !== "select") {
        this.selected = null;
        this.group = [];
        this.groupBounds = null;
      }
      this.updateToolUI();
    }

    updateToolUI() {
      els.tools.querySelectorAll("[data-tool]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tool === this.tool);
      });
      els.save.disabled = this.blocks.length === 0;
      els.undo.disabled = this.past.length === 0;
      els.redo.disabled = this.future.length === 0;
    }

    setMaterial(material) {
      if (!BLOCKS[material]) return;
      this.material = material;
      els.materials.querySelectorAll("[data-mat]").forEach((button) => {
        button.classList.toggle("selected", button.dataset.mat === material);
      });
    }

    // ---------- 画布坐标 ----------
    resize() {
      const rect = els.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      els.canvas.width = Math.round(this.width * this.dpr);
      els.canvas.height = Math.round(this.height * this.dpr);
      this.scale = Math.min(this.width / WORLD_WIDTH, this.height / WORLD_HEIGHT);
      this.offsetX = (this.width - WORLD_WIDTH * this.scale) / 2;
      this.offsetY = (this.height - WORLD_HEIGHT * this.scale) / 2;
    }

    updatePointer(event) {
      const rect = els.canvas.getBoundingClientRect();
      this.pointer.x = event.clientX - rect.left;
      this.pointer.y = event.clientY - rect.top;
      this.pointer.inside = true;
    }

    worldPoint() {
      return {
        x: Math.max(0, Math.min(WORLD_WIDTH, (this.pointer.x - this.offsetX) / this.scale)),
        y: Math.max(0, Math.min(WORLD_HEIGHT, (this.pointer.y - this.offsetY) / this.scale))
      };
    }

    getSnap() {
      return this.ctrlHeld ? SNAP_COARSE : SNAP_FINE;
    }

    getRotSnap() {
      return this.ctrlHeld ? ROT_SNAP_COARSE : ROT_SNAP_FINE;
    }

    placeGhost() {
      const ghost = this.ghostBlock();
      this.blocks.push({ ...ghost, id: this.nextBlockId });
      this.nextBlockId += 1;
      this.lastPlaced = this.blocks[this.blocks.length - 1];
      this.dirty = true;
    }

    blocksOverlap(a, b) {
      const ra = this.rotatedAABB(a);
      const rb = this.rotatedAABB(b);
      return ra.x < rb.x + rb.width && ra.x + ra.width > rb.x && ra.y < rb.y + rb.height && ra.y + ra.height > rb.y;
    }

    ghostBlock() {
      const point = this.worldPoint();
      const spec = BLOCKS[this.material];
      const hw = spec.width / 2;
      const hh = spec.height / 2;
      const rotated = !!spec.rot;
      const extX = rotated ? hh : hw;
      const extY = rotated ? hw : hh;
      const snap = this.getSnap();
      const centerX = Math.min(WORLD_WIDTH - extX, Math.max(extX, Math.round(point.x / snap) * snap));
      const centerY = Math.min(WORLD_HEIGHT - extY, Math.max(extY, Math.round(point.y / snap) * snap));
      return { id: 0, x: centerX - hw, y: centerY - hh, width: spec.width, height: spec.height, rot: spec.rot || 0 };
    }

    containsPoint(block, px, py) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const dx = px - (block.x + hw);
      const dy = py - (block.y + hh);
      const rad = (block.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
    }

    coveredBy(block, candidates) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rad = (block.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const step = Math.max(5, Math.min(block.width, block.height) / 24);
      const xSteps = Math.max(1, Math.round(block.width / step));
      const ySteps = Math.max(1, Math.round(block.height / step));
      for (let xi = 0; xi <= xSteps; xi += 1) {
        for (let yi = 0; yi <= ySteps; yi += 1) {
          const lx = -hw + (block.width * xi) / xSteps;
          const ly = -hh + (block.height * yi) / ySteps;
          const wx = block.x + hw + lx * cos - ly * sin;
          const wy = block.y + hh + lx * sin + ly * cos;
          if (!candidates.some((candidate) => this.containsPoint(candidate, wx, wy))) return false;
        }
      }
      return true;
    }

    pruneCovered() {
      const blocks = this.blocks;
      const removal = [];
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        const aabb = this.rotatedAABB(block);
        const candidates = [];
        for (let j = i + 1; j < blocks.length; j += 1) {
          const other = blocks[j];
          const otherBox = this.rotatedAABB(other);
          if (otherBox.x <= aabb.x + aabb.width && otherBox.x + otherBox.width >= aabb.x && otherBox.y <= aabb.y + aabb.height && otherBox.y + otherBox.height >= aabb.y) {
            candidates.push(other);
          }
        }
        if (candidates.length && this.coveredBy(block, candidates)) removal.push(block);
      }
      for (const block of removal) this.removeBlock(block);
    }

    clampHandlePoint(x, y) {
      const m = 12 / this.scale;
      return {
        x: Math.min(WORLD_WIDTH - m, Math.max(m, x)),
        y: Math.min(WORLD_HEIGHT - m, Math.max(m, y))
      };
    }

    handlePos(block) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rad = (block.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ly = -(hh + HANDLE_OFFSET_PX / this.scale);
      return this.clampHandlePoint(block.x + hw - ly * sin, block.y + hh + ly * cos);
    }

    handleHitRadius() {
      return 15 / this.scale;
    }

    hitBlockAt(wx, wy) {
      for (let i = this.blocks.length - 1; i >= 0; i -= 1) {
        const block = this.blocks[i];
        const hw = block.width / 2;
        const hh = block.height / 2;
        const dx = wx - (block.x + hw);
        const dy = wy - (block.y + hh);
        const rad = (block.rot || 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return block;
      }
      return null;
    }

    // ---------- 指针操作 ----------
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      this.updatePointer(event);
      els.canvas.setPointerCapture(event.pointerId);
      const point = this.worldPoint();
      if (this.tool === "place") {
        this.pushHistory();
        this.placeGhost();
        this.drag = { mode: "place" };
        this.pruneCovered();
        if (this.lastPlaced && !this.blocks.includes(this.lastPlaced)) this.lastPlaced = null;
        this.updateToolUI();
      } else if (this.tool === "erase") {
        const hit = this.hitBlockAt(point.x, point.y);
        if (hit) {
          this.pushHistory();
          this.removeBlock(hit);
        }
        this.drag = { mode: "erase", lastX: point.x, lastY: point.y, historyPushed: !!hit };
      } else {
        if (this.group.length >= 2 && this.groupBounds) {
          if (Math.hypot(point.x - this.groupBounds.handle.x, point.y - this.groupBounds.handle.y) <= this.handleHitRadius()) {
            this.drag = { mode: "groupRotate", startBlocks: this.group.map((block) => ({ ...block })), historyPushed: false };
            return;
          }
          if (Math.hypot(point.x - this.groupBounds.trash.x, point.y - this.groupBounds.trash.y) <= this.handleHitRadius()) {
            this.pushHistory();
            for (const block of this.group) {
              this.blocks.splice(this.blocks.indexOf(block), 1);
            }
            this.group = [];
            this.groupBounds = null;
            this.dirty = true;
            this.updateToolUI();
            return;
          }
          if (Math.hypot(point.x - this.groupBounds.copy.x, point.y - this.groupBounds.copy.y) <= this.handleHitRadius()) {
            this.pushHistory();
            const copies = this.duplicateBlocks(this.group);
            this.group = copies;
            this.selected = null;
            this.computeGroupBounds();
            this.updateToolUI();
            return;
          }
        }
        const handle = this.selected ? this.handlePos(this.selected) : null;
        if (handle && Math.hypot(point.x - handle.x, point.y - handle.y) <= this.handleHitRadius()) {
          this.drag = { block: this.selected, mode: "rotate", historyPushed: false };
          return;
        }
        const trash = this.selected ? this.trashPos(this.selected) : null;
        if (trash && Math.hypot(point.x - trash.x, point.y - trash.y) <= this.handleHitRadius()) {
          this.pushHistory();
          this.removeBlock(this.selected);
          return;
        }
        const copyBtn = this.selected ? this.copyPos(this.selected) : null;
        if (copyBtn && Math.hypot(point.x - copyBtn.x, point.y - copyBtn.y) <= this.handleHitRadius()) {
          this.pushHistory();
          const copies = this.duplicateBlocks([this.selected]);
          this.selectSingle(copies[0]);
          this.updateToolUI();
          return;
        }
        const hit = this.hitBlockAt(point.x, point.y);
        if (hit) {
          if (event.shiftKey) {
            this.toggleSelect(hit);
            this.updateToolUI();
            return;
          }
          if (this.group.includes(hit)) {
            this.drag = { mode: "groupMove", startX: point.x, startY: point.y, startBlocks: this.group.map((block) => ({ ...block })), moved: false, historyPushed: false };
          } else {
            this.selectSingle(hit);
            this.drag = { block: hit, mode: "move", startX: point.x, startY: point.y, origX: hit.x, origY: hit.y, moved: false, historyPushed: false };
          }
        } else {
          this.drag = { mode: "box", startX: point.x, startY: point.y, endX: point.x, endY: point.y, additive: event.shiftKey };
        }
        this.updateToolUI();
      }
    }

    onPointerMove(event) {
      this.updatePointer(event);
      if (!this.drag) return;
      const point = this.worldPoint();
      const drag = this.drag;
      if (drag.mode === "erase") {
        const from = { x: drag.lastX, y: drag.lastY };
        drag.lastX = point.x;
        drag.lastY = point.y;
        const distance = Math.hypot(point.x - from.x, point.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / 24));
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          const hit = this.hitBlockAt(from.x + (point.x - from.x) * t, from.y + (point.y - from.y) * t);
          if (hit) {
            if (!drag.historyPushed) {
              this.pushHistory();
              drag.historyPushed = true;
            }
            this.removeBlock(hit);
          }
        }
        return;
      }
      if (drag.mode === "place") {
        const ghost = this.ghostBlock();
        if (!this.lastPlaced || !this.blocksOverlap(ghost, this.lastPlaced)) {
          this.placeGhost();
          this.pruneCovered();
          if (this.lastPlaced && !this.blocks.includes(this.lastPlaced)) this.lastPlaced = null;
        }
        return;
      }
      if (drag.mode === "box") {
        drag.endX = point.x;
        drag.endY = point.y;
        return;
      }
      if (drag.mode === "groupRotate") {
        const bounds = this.groupBounds;
        const dx = point.x - bounds.cx;
        const dy = point.y - bounds.cy;
        if (dx * dx + dy * dy < 2304) return;
        const deg = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
        const rotSnap = this.getRotSnap();
        const snapped = ((Math.round(deg / rotSnap) * rotSnap) % 360 + 360) % 360;
        const rad = snapped * Math.PI / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const candidates = drag.startBlocks.map((block) => {
          const ox = block.x + block.width / 2 - bounds.cx;
          const oy = block.y + block.height / 2 - bounds.cy;
          const nx = bounds.cx + ox * cosR - oy * sinR;
          const ny = bounds.cy + ox * sinR + oy * cosR;
          return { x: nx - block.width / 2, y: ny - block.height / 2, width: block.width, height: block.height, rot: (((block.rot || 0) + snapped) % 360 + 360) % 360 };
        });
        if (candidates.some((candidate) => !this.inWorld(candidate))) return;
        if (!drag.historyPushed) {
          this.pushHistory();
          drag.historyPushed = true;
        }
        this.group.forEach((block, index) => {
          block.x = candidates[index].x;
          block.y = candidates[index].y;
          block.rot = candidates[index].rot;
        });
        this.dirty = true;
        return;
      }
      if (drag.mode === "rotate") {
        const block = drag.block;
        const cx = block.x + block.width / 2;
        const cy = block.y + block.height / 2;
        const dx = point.x - cx;
        const dy = point.y - cy;
        if (dx * dx + dy * dy < 2304) return;
        const deg = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
        const rotSnap = this.getRotSnap();
        const snapped = ((Math.round(deg / rotSnap) * rotSnap) % 360 + 360) % 360;
        if (snapped !== (block.rot || 0)) {
          if (!drag.historyPushed) {
            this.pushHistory();
            drag.historyPushed = true;
          }
          block.rot = snapped;
          this.dirty = true;
        }
        return;
      }
      if (drag.mode === "groupMove") {
        const dx = point.x - drag.startX;
        const dy = point.y - drag.startY;
        if (!drag.moved && dx * dx + dy * dy < 400) return;
        drag.moved = true;
        const snap = this.getSnap();
        const sx = Math.round(dx / snap) * snap;
        const sy = Math.round(dy / snap) * snap;
        const candidates = drag.startBlocks.map((block) => ({
          x: block.x + sx,
          y: block.y + sy,
          width: block.width,
          height: block.height,
          rot: block.rot || 0
        }));
        if (candidates.some((candidate) => !this.inWorld(candidate))) return;
        if (!drag.historyPushed) {
          this.pushHistory();
          drag.historyPushed = true;
        }
        this.group.forEach((block, index) => {
          block.x = candidates[index].x;
          block.y = candidates[index].y;
        });
        this.computeGroupBounds();
        this.dirty = true;
        return;
      }
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (!drag.moved && dx * dx + dy * dy < 400) return;
      drag.moved = true;
      const block = drag.block;
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rotated = ((block.rot || 0) % 180) !== 0;
      const extX = rotated ? hh : hw;
      const extY = rotated ? hw : hh;
      const snap = this.getSnap();
      const cx = Math.min(WORLD_WIDTH - extX, Math.max(extX, Math.round((drag.origX + hw + dx) / snap) * snap));
      const cy = Math.min(WORLD_HEIGHT - extY, Math.max(extY, Math.round((drag.origY + hh + dy) / snap) * snap));
      const candidate = { x: cx - hw, y: cy - hh, width: block.width, height: block.height, rot: block.rot || 0 };
      if (!drag.historyPushed) {
        this.pushHistory();
        drag.historyPushed = true;
      }
      block.x = candidate.x;
      block.y = candidate.y;
      this.dirty = true;
    }

    onPointerUp() {
      const drag = this.drag;
      if (drag && drag.mode === "box") this.finishBoxSelection();
      if (drag && drag.mode === "place") {
        this.pruneCovered();
        this.updateToolUI();
      }
      if (drag && drag.mode === "groupRotate") this.computeGroupBounds();
      this.drag = null;
    }

    finishBoxSelection() {
      const drag = this.drag;
      const x = Math.min(drag.startX, drag.endX);
      const y = Math.min(drag.startY, drag.endY);
      const width = Math.abs(drag.endX - drag.startX);
      const height = Math.abs(drag.endY - drag.startY);
      const inside = this.blocks.filter((block) => {
        const cx = block.x + block.width / 2;
        const cy = block.y + block.height / 2;
        return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
      });
      if (drag.additive) {
        const merged = this.currentSelection();
        for (const block of inside) {
          if (!merged.includes(block)) merged.push(block);
        }
        this.applySelectionList(merged);
        this.updateToolUI();
        return;
      }
      if (inside.length >= 2) {
        this.selected = null;
        this.group = inside;
        this.computeGroupBounds();
      } else if (inside.length === 1) {
        this.selectSingle(inside[0]);
      } else {
        this.clearSelection();
      }
      this.updateToolUI();
    }

    currentSelection() {
      const list = this.selected ? [this.selected] : [];
      for (const block of this.group) {
        if (!list.includes(block)) list.push(block);
      }
      return list;
    }

    applySelectionList(list) {
      if (list.length >= 2) {
        this.selected = null;
        this.group = list;
        this.computeGroupBounds();
      } else if (list.length === 1) {
        this.selectSingle(list[0]);
      } else {
        this.clearSelection();
      }
    }

    toggleSelect(block) {
      const list = this.currentSelection();
      const idx = list.indexOf(block);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(block);
      this.applySelectionList(list);
    }

    selectSingle(block) {
      this.selected = block;
      this.group = [];
      this.groupBounds = null;
    }

    clearSelection() {
      this.selected = null;
      this.group = [];
      this.groupBounds = null;
    }

    computeGroupBounds() {
      if (this.group.length < 2) {
        this.groupBounds = null;
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const block of this.group) {
        const aabb = this.rotatedAABB(block);
        minX = Math.min(minX, aabb.x);
        minY = Math.min(minY, aabb.y);
        maxX = Math.max(maxX, aabb.x + aabb.width);
        maxY = Math.max(maxY, aabb.y + aabb.height);
      }
      const cx = (minX + maxX) / 2;
      const offset = HANDLE_OFFSET_PX / this.scale;
      this.groupBounds = {
        cx,
        cy: (minY + maxY) / 2,
        handle: this.clampHandlePoint(cx, minY - offset),
        trash: this.clampHandlePoint(cx, maxY + offset),
        copy: this.clampHandlePoint(maxX + offset, (minY + maxY) / 2)
      };
    }

    rotatedAABB(block) {
      if (!block.rot) return { x: block.x, y: block.y, width: block.width, height: block.height };
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rad = block.rot * Math.PI / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const extentX = hw * cos + hh * sin;
      const extentY = hw * sin + hh * cos;
      return { x: block.x + hw - extentX, y: block.y + hh - extentY, width: extentX * 2, height: extentY * 2 };
    }

    inWorld(block) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rotated = ((block.rot || 0) % 180) !== 0;
      const extX = rotated ? hh : hw;
      const extY = rotated ? hw : hh;
      const cx = block.x + hw;
      const cy = block.y + hh;
      return cx - extX >= 0 && cx + extX <= WORLD_WIDTH && cy - extY >= 0 && cy + extY <= WORLD_HEIGHT;
    }

    trashPos(block) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rad = (block.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ly = hh + HANDLE_OFFSET_PX / this.scale;
      return this.clampHandlePoint(block.x + hw - ly * sin, block.y + hh + ly * cos);
    }

    copyPos(block) {
      const hw = block.width / 2;
      const hh = block.height / 2;
      const rad = (block.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = hw + HANDLE_OFFSET_PX / this.scale;
      return this.clampHandlePoint(block.x + hw + lx * cos, block.y + hh + lx * sin);
    }

    duplicateBlocks(source) {
      const snap = this.getSnap();
      const copies = source.map((block) => {
        const copy = { ...block, id: this.nextBlockId };
        this.nextBlockId += 1;
        const rotated = ((copy.rot || 0) % 180) !== 0;
        const extX = rotated ? copy.height / 2 : copy.width / 2;
        const extY = rotated ? copy.width / 2 : copy.height / 2;
        const cx = Math.min(WORLD_WIDTH - extX, Math.max(extX, copy.x + copy.width / 2 + snap));
        const cy = Math.min(WORLD_HEIGHT - extY, Math.max(extY, copy.y + copy.height / 2 + snap));
        copy.x = cx - copy.width / 2;
        copy.y = cy - copy.height / 2;
        return copy;
      });
      this.blocks.push(...copies);
      this.dirty = true;
      return copies;
    }

    removeBlock(block) {
      this.blocks.splice(this.blocks.indexOf(block), 1);
      if (this.selected === block) this.selected = null;
      if (this.lastPlaced === block) this.lastPlaced = null;
      if (this.group.includes(block)) {
        this.group = [];
        this.groupBounds = null;
      }
      this.dirty = true;
      this.updateToolUI();
    }

    snapshotBlocks() {
      return this.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height, rot: block.rot || 0, id: block.id }));
    }

    pushHistory() {
      this.past.push(this.snapshotBlocks());
      if (this.past.length > 100) this.past.shift();
      this.future = [];
      this.updateToolUI();
    }

    restoreBlocks(list) {
      this.blocks = list.map((block) => ({ ...block }));
      this.nextBlockId = this.blocks.reduce((max, block) => Math.max(max, block.id), 0) + 1;
      this.clearSelection();
      this.pruneCovered();
      this.dirty = true;
      this.updateToolUI();
    }

    undo() {
      if (!this.past.length) return;
      this.future.push(this.snapshotBlocks());
      this.restoreBlocks(this.past.pop());
    }

    redo() {
      if (!this.future.length) return;
      this.past.push(this.snapshotBlocks());
      this.restoreBlocks(this.future.pop());
    }

    // ---------- 渲染 ----------
    startLoop() {
      const tick = () => {
        if (!this.editorOpen) return;
        this.render();
        this.raf = window.requestAnimationFrame(tick);
      };
      window.cancelAnimationFrame(this.raf);
      this.raf = window.requestAnimationFrame(tick);
    }

    render() {
      const context = this.context;
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      context.fillStyle = "#0d0a1a";
      context.fillRect(0, 0, this.width, this.height);
      context.save();
      context.translate(this.offsetX, this.offsetY);
      context.scale(this.scale, this.scale);
      if (typeof game === "undefined" || game.editorGrid) {
        context.lineWidth = 1 / this.scale;
        context.strokeStyle = "rgba(100, 251, 210, 0.06)";
        context.beginPath();
        for (let x = 0; x <= WORLD_WIDTH; x += 60) {
          context.moveTo(x, 0);
          context.lineTo(x, WORLD_HEIGHT);
        }
        for (let y = 0; y <= WORLD_HEIGHT; y += 60) {
          context.moveTo(0, y);
          context.lineTo(WORLD_WIDTH, y);
        }
        context.stroke();
      }
      context.strokeStyle = "rgba(100, 251, 210, 0.4)";
      context.lineWidth = 2 / this.scale;
      context.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      for (const block of this.blocks) {
        if (block === this.selected || this.group.includes(block)) continue;
        this.drawBlock(context, block, false, 1);
      }
      if (this.selected) this.drawBlock(context, this.selected, true, 1);
      for (const block of this.group) this.drawBlock(context, block, true, 1);
      if (this.tool === "select") {
        if (this.selected) {
          this.drawRotationHandle(context, this.selected);
          this.drawTrashIcon(context, this.trashPos(this.selected));
          this.drawCopyIcon(context, this.copyPos(this.selected));
        } else if (this.group.length >= 2 && this.groupBounds) {
          this.drawGroupHandle(context, this.groupBounds);
          this.drawTrashIcon(context, this.groupBounds.trash);
          this.drawCopyIcon(context, this.groupBounds.copy);
        }
        if (this.drag && this.drag.mode === "box") {
          const x = Math.min(this.drag.startX, this.drag.endX);
          const y = Math.min(this.drag.startY, this.drag.endY);
          const w = Math.abs(this.drag.endX - this.drag.startX);
          const h = Math.abs(this.drag.endY - this.drag.startY);
          context.fillStyle = "rgba(100, 251, 210, 0.08)";
          context.fillRect(x, y, w, h);
          context.strokeStyle = "#64fbd2";
          context.lineWidth = 2 / this.scale;
          context.strokeRect(x, y, w, h);
        }
      }
      if (this.tool === "place" && this.pointer.inside) {
        const ghost = this.ghostBlock();
        this.drawBlock(context, ghost, false, 0.5, "#64fbd2");
      }
      context.restore();
    }

    drawBlock(context, block, selected, alpha, outline = null) {
      context.save();
      context.globalAlpha = alpha;
      const hw = block.width / 2;
      const hh = block.height / 2;
      context.translate(block.x + hw, block.y + hh);
      context.rotate((block.rot || 0) * Math.PI / 180);
      context.fillStyle = selected ? "#1b2f42" : "#152334";
      context.fillRect(-hw, -hh, block.width, block.height);
      context.strokeStyle = outline || (selected ? "#65a9ff" : "#64fbd2");
      context.lineWidth = (selected ? 3 : 2) / this.scale;
      context.strokeRect(-hw + 1.5, -hh + 1.5, block.width - 3, block.height - 3);
      context.fillStyle = selected ? "rgba(101, 169, 255, 0.5)" : "rgba(255, 209, 102, 0.32)";
      for (let x = -hw + 12; x < hw - 12; x += 28) context.fillRect(x, -hh + 8, 14, 3);
      context.restore();
    }

    drawHandleKnob(context, x, y) {
      context.fillStyle = "#65a9ff";
      context.beginPath();
      context.arc(x, y, 9 / this.scale, 0, Math.PI * 2);
      context.fill();
      const r = 4.5 / this.scale;
      const start = -Math.PI * 0.6;
      const end = Math.PI * 1.05;
      context.strokeStyle = "#122a44";
      context.lineWidth = 1.7 / this.scale;
      context.lineCap = "round";
      context.beginPath();
      context.arc(x, y, r, start, end);
      context.stroke();
      const tipX = x + Math.cos(end) * r;
      const tipY = y + Math.sin(end) * r;
      const dir = end + Math.PI / 2;
      context.fillStyle = "#0d2a24";
      context.beginPath();
      context.moveTo(tipX + Math.cos(dir) * 2.3 / this.scale, tipY + Math.sin(dir) * 2.3 / this.scale);
      context.lineTo(tipX - Math.cos(dir) * 2.3 / this.scale, tipY - Math.sin(dir) * 2.3 / this.scale);
      context.lineTo(tipX + Math.cos(end) * 3 / this.scale, tipY + Math.sin(end) * 3 / this.scale);
      context.closePath();
      context.fill();
    }

    drawRotationHandle(context, block) {
      const cx = block.x + block.width / 2;
      const cy = block.y + block.height / 2;
      const handle = this.handlePos(block);
      context.strokeStyle = "rgba(101, 169, 255, 0.7)";
      context.lineWidth = 2 / this.scale;
      context.beginPath();
      context.moveTo(cx, cy);
      context.lineTo(handle.x, handle.y);
      context.stroke();
      this.drawHandleKnob(context, handle.x, handle.y);
    }

    drawGroupHandle(context, bounds) {
      context.strokeStyle = "rgba(101, 169, 255, 0.7)";
      context.lineWidth = 2 / this.scale;
      context.beginPath();
      context.moveTo(bounds.cx, bounds.cy);
      context.lineTo(bounds.handle.x, bounds.handle.y);
      context.stroke();
      this.drawHandleKnob(context, bounds.handle.x, bounds.handle.y);
    }

    drawCopyIcon(context, point) {
      const x = point.x;
      const y = point.y;
      const u = 1 / this.scale;
      context.fillStyle = "#65a9ff";
      context.beginPath();
      context.arc(x, y, 9 * u, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#122a44";
      context.lineWidth = 1.2 * u;
      context.strokeRect(x - 4 * u, y - 4.4 * u, 5.2 * u, 6.4 * u);
      context.fillStyle = "#122a44";
      context.fillRect(x - 1.4 * u, y - 1.8 * u, 5.2 * u, 6.4 * u);
    }

    drawTrashIcon(context, point) {
      const x = point.x;
      const y = point.y;
      context.fillStyle = "#ff6178";
      context.beginPath();
      context.arc(x, y, 9 / this.scale, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#3a0d14";
      context.lineWidth = 1.4 / this.scale;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x - 3.8 / this.scale, y - 2.2 / this.scale);
      context.lineTo(x + 3.8 / this.scale, y - 2.2 / this.scale);
      context.moveTo(x - 3 / this.scale, y - 2.2 / this.scale);
      context.lineTo(x - 2.2 / this.scale, y + 4 / this.scale);
      context.lineTo(x + 2.2 / this.scale, y + 4 / this.scale);
      context.lineTo(x + 3 / this.scale, y - 2.2 / this.scale);
      context.moveTo(x - 1.2 / this.scale, y - 3.4 / this.scale);
      context.lineTo(x + 1.2 / this.scale, y - 3.4 / this.scale);
      context.stroke();
    }
  }

  window.mapPreview = {
    prepare(canvas) {
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#0d0a1a";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return context;
    },
    drawCustom(canvas, blocks) {
      const context = this.prepare(canvas);
      const scale = Math.min(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT);
      const ox = (canvas.width - WORLD_WIDTH * scale) / 2;
      const oy = (canvas.height - WORLD_HEIGHT * scale) / 2;
      for (const block of blocks) {
        context.save();
        context.translate(ox + (block.x + block.width / 2) * scale, oy + (block.y + block.height / 2) * scale);
        context.rotate((block.rot || 0) * Math.PI / 180);
        const bw = block.width * scale;
        const bh = Math.max(2, block.height * scale);
        context.fillStyle = "#64fbd2";
        context.fillRect(-bw / 2, -bh / 2, bw, bh);
        context.restore();
      }
    },
    drawBuiltin(canvas, id) {
      const context = this.prepare(canvas);
      const scale = Math.min(canvas.width / WORLD_WIDTH, canvas.height / WORLD_HEIGHT);
      const ox = (canvas.width - WORLD_WIDTH * scale) / 2;
      const oy = (canvas.height - WORLD_HEIGHT * scale) / 2;
      const X = (x) => ox + x * scale;
      const Y = (y) => oy + y * scale;
      const S = (v) => Math.max(1, v * scale);
      const cx = WORLD_WIDTH / 2;
      const cy = WORLD_HEIGHT / 2;
      const color = id === "dock" ? "#ffd166" : id === "furnace" ? "#ff8a65" : id === "gravity" ? "#ad8cff" : id === "storm" ? "#65a9ff" : id === "matrix" ? "#7dff8a" : "#64fbd2";
      context.fillStyle = color;
      context.strokeStyle = color;
      if (id === "harbor") {
        context.globalAlpha = 0.85;
        [
          [470, 310, 210, 48], [470, 310, 48, 190],
          [1720, 310, 210, 48], [1882, 310, 48, 190],
          [470, 1242, 210, 48], [470, 1100, 48, 190],
          [1720, 1242, 210, 48], [1882, 1100, 48, 190]
        ].forEach(([x, y, w, h]) => context.fillRect(X(x), Y(y), S(w), S(h)));
      } else if (id === "dock") {
        context.globalAlpha = 0.5;
        context.lineWidth = 1.5;
        [230, 420, 610].forEach((r) => {
          context.beginPath();
          context.arc(X(cx), Y(cy), S(r), 0, Math.PI * 2);
          context.stroke();
        });
        context.globalAlpha = 0.95;
        [{ orbit: 230, radius: 38, count: 4 }, { orbit: 420, radius: 42, count: 5 }, { orbit: 610, radius: 46, count: 6 }].forEach((ring) => {
          for (let i = 0; i < ring.count; i += 1) {
            const a = i * Math.PI * 2 / ring.count;
            context.beginPath();
            context.arc(X(cx + Math.cos(a) * ring.orbit), Y(cy + Math.sin(a) * ring.orbit), S(ring.radius), 0, Math.PI * 2);
            context.fill();
          }
        });
      } else if (id === "furnace") {
        context.globalAlpha = 0.5;
        context.lineWidth = 1;
        [[300, 280, 250, 160], [1850, 280, 250, 160], [300, 1160, 250, 160], [1850, 1160, 250, 160]].forEach(([x, y, w, h]) => {
          context.fillRect(X(x), Y(y), S(w), S(h));
          context.strokeRect(X(x), Y(y), S(w), S(h));
        });
        context.globalAlpha = 0.7;
        [[760, 520], [1200, 420], [1640, 520], [760, 1080], [1200, 1180], [1640, 1080]].forEach(([x, y]) => {
          context.beginPath();
          context.arc(X(x), Y(y), S(88), 0, Math.PI * 2);
          context.fill();
          context.stroke();
        });
      } else if (id === "gravity") {
        context.lineWidth = 1;
        [[420, 320], [1980, 320], [420, 1280], [1980, 1280]].forEach(([x, y]) => {
          context.globalAlpha = 0.55;
          context.beginPath();
          context.arc(X(x), Y(y), S(285), 0, Math.PI * 2);
          context.stroke();
          context.globalAlpha = 0.9;
          context.beginPath();
          context.arc(X(x), Y(y), S(34), 0, Math.PI * 2);
          context.fill();
          const angle = Math.atan2(cy - y, cx - x);
          context.globalAlpha = 0.4;
          context.beginPath();
          context.arc(X(x + Math.cos(angle) * 185), Y(y + Math.sin(angle) * 185), S(27), 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = 0.9;
          context.stroke();
        });
      } else if (id === "storm") {
        context.globalAlpha = 0.4;
        context.lineWidth = 1;
        [360, 900, 1440, 1980].forEach((x) => {
          context.strokeRect(X(x), Y(16), S(220), S(WORLD_HEIGHT - 32));
        });
      } else if (id === "matrix") {
        context.globalAlpha = 0.5;
        context.lineWidth = 1;
        context.beginPath();
        for (let x = 200; x < WORLD_WIDTH; x += 200) {
          context.moveTo(X(x), Y(16));
          context.lineTo(X(x), Y(WORLD_HEIGHT - 16));
        }
        for (let y = 200; y < WORLD_HEIGHT; y += 200) {
          context.moveTo(X(16), Y(y));
          context.lineTo(X(WORLD_WIDTH - 16), Y(y));
        }
        context.stroke();
      }
      context.globalAlpha = 1;
    },
    drawRandom(canvas) {
      const context = this.prepare(canvas);
      context.fillStyle = "#64fbd2";
      context.font = "700 46px 'Rajdhani', 'Segoe UI', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("?", canvas.width / 2, canvas.height / 2 + 4);
    }
  };

  window.mapEditor = new MapEditor();
})();
