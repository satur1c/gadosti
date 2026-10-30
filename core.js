import * as ST from '../../../../script.js';
import * as WI from '../../../world-info.js';
import * as EXT from '../../../extensions.js';
import * as UTILS from '../../../utils.js';
import * as PERS from '../../../personas.js';
import * as PU from '../../../power-user.js';

export const NS = 'phoneMouse';
export const DEFAULTS = { enabled: true, contextRange: 20, refreshOnOpen: false, autoScan: false, scanEvery: 8, scanDepth: 20, phoneScale: 0 };

const ctx = () => SillyTavern.getContext();
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const msgOf = e => (e && e.message ? e.message : String(e));

export function settings() {
    const all = EXT.extension_settings;
    if (!all[NS]) all[NS] = {};
    const s = all[NS];
    for (const k of Object.keys(DEFAULTS)) if (s[k] === undefined) s[k] = DEFAULTS[k];
    if (!s.data || typeof s.data !== 'object') s.data = {};
    return s;
}

const errTimes = new Map();
export function fail(where, e) {
    const text = where + ': ' + msgOf(e);
    console.error('[PHONE MOUSE] ' + text, e);
    const now = Date.now();
    if (now - (errTimes.get(text) || 0) < 4000) return;
    errTimes.set(text, now);
    try { toastr.error(text, 'PHONE MOUSE', { timeOut: 9000 }); } catch (err) {}
}

function toast(text) {
    try { toastr.info(String(text)); } catch (e) { console.log(text); }
}

function headers() {
    return ctx().getRequestHeaders();
}

async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) {
        let t = '';
        try { t = (await res.text()).slice(0, 200); } catch (e) {}
        throw new Error(url + ' → ' + res.status + (t ? ' ' + t : ''));
    }
    return res;
}

function chatBag() {
    const meta = ctx().chatMetadata;
    if (!meta[NS] || typeof meta[NS] !== 'object') meta[NS] = {};
    return meta[NS];
}

const store = {
    get(key, scope) {
        const src = scope === 'global' ? settings().data : chatBag();
        const v = src[key];
        return v === undefined ? null : clone(v);
    },
    set(key, val, scope) {
        if (scope === 'global') {
            const d = settings().data;
            if (val === null || val === undefined) delete d[key];
            else d[key] = clone(val);
            ctx().saveSettingsDebounced();
            return;
        }
        const bag = chatBag();
        if (val === null || val === undefined) delete bag[key];
        else bag[key] = clone(val);
        ctx().saveMetadataDebounced();
    },
    all(scope) {
        return clone(scope === 'global' ? settings().data : chatBag());
    },
};

function toBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(fr.error || new Error('не удалось прочитать файл'));
        fr.readAsDataURL(blob);
    });
}

function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('не удалось прочитать файл'));
        fr.readAsDataURL(blob);
    });
}

function safeUrl(u) {
    return String(u || '').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27').replace(/"/g, '%22');
}

function pickFiles(accept, multiple) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.multiple = !!multiple;
        inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
        document.body.appendChild(inp);
        let done = false;
        const finish = list => {
            if (done) return;
            done = true;
            setTimeout(() => inp.remove(), 800);
            resolve(list);
        };
        inp.addEventListener('change', () => finish(Array.from(inp.files || [])));
        inp.addEventListener('cancel', () => finish([]));
        window.addEventListener('focus', () => setTimeout(() => { if (!inp.files || !inp.files.length) finish([]); }, 1500), { once: true });
        inp.click();
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('файл не открылся как картинка'));
        im.src = src;
    });
}

async function shrink(file, max, quality) {
    const url = URL.createObjectURL(file);
    try {
        const im = await loadImage(url);
        const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const w = Math.max(1, Math.round(im.naturalWidth * k));
        const h = Math.max(1, Math.round(im.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        const png = file.type === 'image/png' && k === 1 && file.size < 1.5 * 1024 * 1024;
        const out = c.toDataURL(png ? 'image/png' : 'image/jpeg', quality);
        return { base64: out.split(',')[1], ext: png ? 'png' : 'jpeg' };
    } finally {
        URL.revokeObjectURL(url);
    }
}

const FOLDER = 'phonemouse';
const uniq = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function saveFile(file, opts) {
    opts = opts || {};
    const isVideo = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
    let base64;
    let ext;
    if (isVideo) {
        ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
        if (file.size > 90 * 1024 * 1024) throw new Error('видео больше 90 МБ');
        base64 = await toBase64(file);
    } else if (file.type === 'image/gif' && file.size < 8 * 1024 * 1024) {
        ext = 'gif';
        base64 = await toBase64(file);
    } else {
        const r = await shrink(file, opts.max || 1600, opts.quality || 0.88);
        base64 = r.base64;
        ext = r.ext;
    }
    const path = await UTILS.saveBase64AsFile(base64, FOLDER, uniq(opts.prefix || 'img'), ext);
    if (!path) throw new Error('сервер не вернул путь к файлу');
    return '/' + String(path).replace(/^\//, '');
}

async function saveDataUrl(dataUrl, opts) {
    opts = opts || {};
    const m = /^data:([a-z]+)\/([a-z0-9.+-]+);base64,(.*)$/is.exec(String(dataUrl));
    if (!m) throw new Error('это не data-адрес');
    let ext = m[2].toLowerCase();
    if (ext === 'jpg') ext = 'jpeg';
    if (ext === 'svg+xml') ext = 'png';
    const path = await UTILS.saveBase64AsFile(m[3], FOLDER, uniq(opts.prefix || 'img'), ext);
    if (!path) throw new Error('сервер не вернул путь к файлу');
    return '/' + String(path).replace(/^\//, '');
}

async function restoreFile(path, dataUrl) {
    const m = /^\/?user\/images\/([A-Za-z0-9_\-]+)\/([A-Za-z0-9_\-]+)\.([a-z0-9]+)$/i.exec(String(path));
    if (!m) throw new Error('странный путь файла: ' + path);
    const d = /^data:[^;]+;base64,(.*)$/s.exec(String(dataUrl));
    if (!d) throw new Error('нет данных файла');
    await UTILS.saveBase64AsFile(d[1], m[1], m[2], m[3].toLowerCase());
}

async function removeImage(path) {
    const rel = String(path || '').replace(/^\/+/, '');
    if (!/^user\/images\//.test(rel)) return false;
    try {
        await post('/api/images/delete', { path: rel });
        return true;
    } catch (e) {
        return false;
    }
}

async function asDataUrl(src) {
    if (/^data:/i.test(src)) return src;
    const res = await fetch(src, { cache: 'force-cache' });
    if (!res.ok) throw new Error(src + ' → ' + res.status);
    return await toDataUrl(await res.blob());
}

function download(name, base64, mime) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function preview(src) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;';
    const isVid = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(src) || /^data:video/.test(src);
    const el = document.createElement(isVid ? 'video' : 'img');
    el.src = src;
    if (isVid) { el.controls = true; el.autoplay = true; }
    el.style.cssText = 'max-width:96vw;max-height:96vh;object-fit:contain;';
    wrap.appendChild(el);
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
}

let saveTimer = null;
function saveChatSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { ctx().saveChat(); } catch (e) { fail('сохранение чата', e); } }, 900);
}

function roleOf(m) {
    if (m.is_user) return 'user';
    if (m.is_system && m.extra && m.extra.type === 'narrator') return 'system';
    return 'assistant';
}

function asMessage(m, i) {
    const out = {
        id: i,
        role: roleOf(m),
        content: String(m.mes || ''),
        hidden: !!m.is_system && !(m.extra && m.extra.type === 'narrator'),
        name: m.name,
    };
    if (m.extra && m.extra.reasoning) out.reasoning = m.extra.reasoning;
    return out;
}

const chat = {
    count() {
        return ctx().chat.length;
    },
    slice(range) {
        const list = ctx().chat;
        const a = Math.max(0, range[0]);
        const b = Math.min(list.length - 1, range[1]);
        const out = [];
        for (let i = a; i <= b; i++) out.push(asMessage(list[i], i));
        return out;
    },
    edit(upd) {
        const c = ctx();
        const m = c.chat[upd.id];
        if (!m) return;
        if (typeof upd.content === 'string' && upd.content !== m.mes) {
            m.mes = upd.content;
            try { c.updateMessageBlock(upd.id, m); } catch (e) {}
        }
        if (typeof upd.hidden === 'boolean' && !!m.is_system !== upd.hidden) {
            m.is_system = upd.hidden;
            const el = document.querySelector('#chat .mes[mesid="' + upd.id + '"]');
            if (el) el.setAttribute('is_system', String(upd.hidden));
        }
        saveChatSoon();
    },
};

const urlProbe = new Map();
async function reachable(url) {
    if (urlProbe.has(url)) return urlProbe.get(url);
    let ok = false;
    try { ok = (await fetch(url, { method: 'GET', cache: 'force-cache' })).ok; } catch (e) {}
    urlProbe.set(url, ok);
    return ok;
}

function thumb(type, file) {
    return typeof ST.getThumbnailUrl === 'function' ? ST.getThumbnailUrl(type, file) : '/thumbnail?type=' + type + '&file=' + encodeURIComponent(file);
}

async function characterAvatar(file) {
    if (!file) return '';
    const full = '/characters/' + encodeURIComponent(file);
    return safeUrl((await reachable(full)) ? full : thumb('avatar', file));
}

function personaFile() {
    const a = PERS.user_avatar || ST.user_avatar;
    if (a) return String(a);
    const el = document.querySelector('#user_avatar_block .avatar-container.selected');
    const f = el && (el.getAttribute('imgfile') || el.getAttribute('data-avatar-id'));
    if (f) return String(f);
    return (PU.power_user && PU.power_user.default_persona) || '';
}

async function personaAvatar(file) {
    if (!file) return '';
    const full = '/User Avatars/' + encodeURIComponent(file);
    return safeUrl((await reachable(full)) ? full : thumb('persona', file));
}

function activeCharacters() {
    const c = ctx();
    if (c.groupId) {
        const g = c.groups.find(x => x.id == c.groupId);
        return ((g && g.members) || []).map(av => c.characters.find(x => x.avatar === av)).filter(Boolean);
    }
    const ch = c.characters[c.characterId];
    return ch ? [ch] : [];
}

function worldNames() {
    return Array.isArray(WI.world_names) ? WI.world_names : [];
}

function boundBooks() {
    const c = ctx();
    const out = [];
    const own = c.chatMetadata && c.chatMetadata.world_info;
    if (own && worldNames().includes(own)) out.push(own);
    for (const n of WI.selected_world_info || []) if (!out.includes(n)) out.push(n);
    return out;
}

async function currentChat() {
    const c = ctx();
    if (!c.chatId) return null;
    const characters = [];
    for (const ch of activeCharacters()) characters.push({ id: ch.avatar, name: ch.name, avatar: await characterAvatar(ch.avatar) });
    const pf = personaFile();
    return {
        id: c.chatId,
        characters,
        persona: { id: pf, name: c.name1, avatar: await personaAvatar(pf) },
        lorebooks: boundBooks().map(n => ({ id: n, name: n })),
    };
}

async function characterCard(avatarFile) {
    const c = ctx();
    const idx = c.characters.findIndex(x => x.avatar === avatarFile);
    if (idx < 0) return null;
    try { await c.unshallowCharacter(idx); } catch (e) {}
    const ch = c.characters[idx];
    return {
        id: ch.avatar,
        name: ch.name,
        avatar: await characterAvatar(ch.avatar),
        description: ch.description || '',
        personality: ch.personality || '',
        scenario: ch.scenario || '',
        mesExample: ch.mes_example || '',
        firstMes: ch.first_mes || '',
    };
}

async function personaCard(file) {
    const pd = PU.power_user && PU.power_user.persona_descriptions;
    const desc = (pd && pd[file] && pd[file].description) || (PU.power_user && PU.power_user.persona_description) || '';
    return { id: file, name: ctx().name1, avatar: await personaAvatar(file), description: desc };
}

async function refreshNames() {
    try { await WI.updateWorldInfoList(); } catch (e) {}
}

async function cleanName(name) {
    try {
        const res = await post('/api/files/sanitize-filename', { fileName: name });
        const j = await res.json();
        if (j && j.fileName) return String(j.fileName).trim();
    } catch (e) {}
    return String(name).replace(/[\\/:*?"<>|]/g, ' ').trim();
}

function entryToBook(e) {
    return {
        identifier: e.pmId || 'uid-' + e.uid,
        name: e.comment || '',
        content: e.content || '',
        enabled: !e.disable,
        strategy: e.constant ? 'constant' : 'keyword',
        keywords: Array.isArray(e.key) ? e.key.slice() : [],
        scanDepth: e.scanDepth === null || e.scanDepth === undefined ? undefined : e.scanDepth,
    };
}

async function activateGlobally(name) {
    if ((WI.selected_world_info || []).includes(name)) return;
    await ctx().executeSlashCommandsWithOptions('/world silent=true state=on ' + JSON.stringify(name));
}

const lore = {
    async all() {
        await refreshNames();
        return worldNames().map(n => ({ id: n, name: n }));
    },
    async find(q) {
        await refreshNames();
        const norm = v => String(v || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        const s = norm(q);
        const names = worldNames();
        return names.filter(n => norm(n) === s).concat(names.filter(n => norm(n) !== s && norm(n).includes(s))).map(n => ({ id: n, name: n }));
    },
    async get(name) {
        let data = null;
        try { data = await WI.loadWorldInfo(name); } catch (e) { data = null; }
        if (!data) return null;
        return { id: name, name, entries: Object.values(data.entries || {}).map(entryToBook) };
    },
    async create(wanted) {
        const base = (await cleanName(wanted)).slice(0, 80).replace(/[. ]+$/, '') || 'Phone Mouse';
        await refreshNames();
        let name = base;
        let i = 2;
        while (worldNames().includes(name)) name = base + ' ' + i++;
        let firstErr = null;
        try {
            await post('/api/worldinfo/edit', { name, data: { entries: {} } });
            await refreshNames();
        } catch (e) {
            firstErr = e;
        }
        if (!worldNames().includes(name) && typeof WI.createNewWorldInfo === 'function') {
            try {
                await WI.createNewWorldInfo(name);
                await refreshNames();
            } catch (e) {
                firstErr = firstErr || e;
            }
        }
        if (!worldNames().includes(name)) throw new Error('лорбук «' + name + '» не создался' + (firstErr ? ': ' + msgOf(firstErr) : ''));
        return name;
    },
    async save(book) {
        const name = book.id;
        let data = await WI.loadWorldInfo(name);
        if (!data) {
            await refreshNames();
            data = await WI.loadWorldInfo(name);
        }
        if (!data) throw new Error('лорбук «' + name + '» не открывается');
        if (!data.entries) data.entries = {};
        const byId = new Map();
        const byName = new Map();
        for (const e of Object.values(data.entries)) {
            byId.set(e.pmId || 'uid-' + e.uid, e);
            if (e.comment && !byName.has(e.comment)) byName.set(e.comment, e);
        }
        const keep = new Set();
        for (const ent of book.entries || []) {
            let raw = byId.get(ent.identifier);
            if (!raw && ent.name) {
                const cand = byName.get(ent.name);
                if (cand && !keep.has(cand.uid)) raw = cand;
            }
            if (!raw) {
                raw = WI.createWorldInfoEntry(name, data);
                if (!raw) throw new Error('не удалось создать запись лорбука');
            }
            raw.pmId = ent.identifier;
            keep.add(raw.uid);
            raw.comment = ent.name || '';
            raw.content = ent.content || '';
            raw.disable = ent.enabled === false;
            raw.constant = ent.strategy === 'constant';
            raw.key = Array.isArray(ent.keywords) ? ent.keywords.slice() : [];
            raw.scanDepth = ent.scanDepth === undefined || ent.scanDepth === null ? null : Number(ent.scanDepth);
        }
        for (const uid of Object.keys(data.entries)) {
            if (!keep.has(Number(uid)) && !keep.has(uid)) delete data.entries[uid];
        }
        try {
            await WI.saveWorldInfo(name, data, true);
        } catch (e) {
            await post('/api/worldinfo/edit', { name, data });
        }
        try { ctx().reloadWorldInfoEditor(name, true); } catch (e) {}
    },
    async bind(name) {
        if (boundBooks().includes(name)) return;
        const c = ctx();
        const own = c.chatMetadata.world_info;
        if (!own || !worldNames().includes(own)) {
            c.chatMetadata.world_info = name;
            c.saveMetadataDebounced();
            try { document.querySelectorAll('.chat_lorebook_button').forEach(b => b.classList.add('world_set')); } catch (e) {}
        } else {
            await activateGlobally(name);
        }
    },
};

const ai = {
    async generate(prompt) {
        if (ST.generateRaw.length >= 1) return await ST.generateRaw(String(prompt), null, false, false, '', null);
        return await ST.generateRaw({ prompt: String(prompt), trimNames: false });
    },
};

const input = {
    set(text) {
        const ta = document.getElementById('send_textarea');
        if (!ta) return;
        ta.value = String(text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
};

function chatMemory() {
    const list = [];
    for (const m of ctx().chat || []) {
        const t = m && m.extra && m.extra.memory ? String(m.extra.memory).trim() : '';
        if (t && list[list.length - 1] !== t) list.push(t);
    }
    return { enabled: true, memories: list.slice(-6) };
}

export const pm = {
    toast,
    fail,
    cfg: key => {
        const v = settings()[key];
        return v === undefined ? null : v;
    },
    store,
    chat,
    lore,
    ai,
    input,
    media: { pick: pickFiles, saveFile, saveDataUrl, toDataUrl, asDataUrl, restore: restoreFile, remove: removeImage, download, preview },
    who: { current: currentChat, character: characterCard, persona: personaCard, memory: chatMemory },
};

export function install() {
    window.PM = pm;
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function selfTest() {
    const lines = [];
    const log = (k, v) => lines.push(k + ': ' + v);
    const step = async (name, fn) => {
        try { log(name, 'OK ' + ((await fn()) || '')); } catch (e) { log(name, 'ОШИБКА ' + msgOf(e)); }
    };
    log('время', new Date().toISOString());
    log('браузер', navigator.userAgent);
    log('экран', innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio);
    await step('версия SillyTavern', async () => {
        const j = await (await fetch('/version')).json();
        return j.pkgVersion + ' ' + (j.gitBranch || '');
    });
    const c = ctx();
    const need = ['chat', 'characters', 'chatMetadata', 'saveChat', 'saveMetadataDebounced', 'saveSettingsDebounced', 'eventSource', 'eventTypes', 'executeSlashCommandsWithOptions', 'updateMessageBlock', 'getRequestHeaders', 'unshallowCharacter', 'loadWorldInfo', 'saveWorldInfo'];
    log('нет в контексте', need.filter(k => c[k] === undefined).join(', ') || 'ничего не пропало');
    log('нет в модулях', [['saveBase64AsFile', UTILS.saveBase64AsFile], ['getThumbnailUrl', ST.getThumbnailUrl], ['generateRaw', ST.generateRaw], ['createWorldInfoEntry', WI.createWorldInfoEntry], ['world_names', WI.world_names], ['user_avatar', PERS.user_avatar !== undefined ? 1 : ST.user_avatar]].filter(p => p[1] === undefined).map(p => p[0]).join(', ') || 'ничего не пропало');
    log('чат', 'chatId=' + c.chatId + ' сообщений=' + c.chat.length);
    const t = document.getElementById('rp_toggle');
    if (t) {
        const r = t.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        log('кнопка', Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' поверх=' + (top ? top.tagName + '#' + top.id : 'нет'));
    } else log('кнопка', 'не создана');
    await step('хранилище чата', async () => { store.set('pm_t', 'x', 'chat'); if (store.get('pm_t', 'chat') !== 'x') throw new Error('не прочиталось'); store.set('pm_t', null, 'chat'); });
    await step('общее хранилище', async () => { store.set('pm_t', { a: 1 }, 'global'); const v = store.get('pm_t', 'global'); store.set('pm_t', null, 'global'); if (!v || v.a !== 1) throw new Error('не прочиталось'); });
    await step('сохранение картинки', async () => {
        const p = await saveDataUrl('data:image/png;base64,' + PNG, { prefix: 'diag' });
        const r = await fetch(p, { cache: 'no-store' });
        if (!r.ok) throw new Error(p + ' → ' + r.status);
        return p + ' → ' + r.status;
    });
    await step('аватар персонажа', async () => {
        const cur = await currentChat();
        if (!cur) throw new Error('чат не открыт');
        const u = cur.characters[0] && cur.characters[0].avatar;
        if (!u) throw new Error('адрес пустой');
        const r = await fetch(u);
        if (!r.ok) throw new Error(u + ' → ' + r.status);
        return u + ' → ' + r.status;
    });
    await step('аватар персоны', async () => {
        const cur = await currentChat();
        if (!cur) throw new Error('чат не открыт');
        if (!cur.persona.avatar) throw new Error('файл персоны не найден');
        const r = await fetch(cur.persona.avatar);
        if (!r.ok) throw new Error(cur.persona.avatar + ' → ' + r.status);
        return cur.persona.avatar + ' → ' + r.status;
    });
    await step('лорбук', async () => {
        const id = await lore.create('PM диагностика');
        await lore.save({ id, entries: [{ identifier: 'd1', name: 'Тест', content: 'a', enabled: true, strategy: 'constant', keywords: [] }] });
        const b1 = await lore.get(id);
        b1.entries[0].content = 'b';
        await lore.save(b1);
        const b2 = await lore.get(id);
        await post('/api/worldinfo/delete', { name: id });
        await refreshNames();
        if (!b1 || b1.entries.length !== 1 || !b2 || b2.entries[0].content !== 'b') throw new Error('запись не сохранилась');
        return id;
    });
    await step('чат телефона', async () => {
        const th = chatBag().rp_cx_threads || [], cs = chatBag().rp_cx_contacts || [];
        const nm = id => id === 'char' ? 'ГЕРОЙ' : id === 'me' ? 'я' : ((cs.find(x => x.id === id) || {}).name || '?' + id);
        const gr = th.filter(x => x.kind === 'group').map(x => '«' + (x.title || '') + '»: ' + (x.who || []).map(nm).join(', '));
        const lr = chatBag().rp_cx_lastraw;
        return 'контактов=' + cs.length + (gr.length ? ' группы=[' + gr.join(' | ') + ']' : ' групп нет') + (lr ? ' последний_ответ=' + JSON.stringify(lr).slice(0, 700) : '');
    });
    return lines.join('\n');
}
