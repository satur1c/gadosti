const KEY = 'phoneMouseHint';
const ctx = () => SillyTavern.getContext();
const wait = ms => new Promise(r => setTimeout(r, ms));
const hash = s => { let h = 5381; s = String(s || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };
let echo = 0;

function put(text) {
    try { ctx().setExtensionPrompt(KEY, text || '', 1, 0, false, 1); } catch (e) {}
}

async function pack() {
    const req = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    try { document.dispatchEvent(new CustomEvent('rp-phone:hint', { detail: { req } })); } catch (e) {}
    if (echo >= 0) {
        for (let i = 0; i < 12; i++) {
            await wait(150);
            const p = window.PM && window.PM.store.get('rp_hint_pack', 'chat');
            if (p && p.req === req) { echo = 1; return p; }
        }
        if (echo === 0) echo = -1;
    }
    return window.PM ? window.PM.store.get('rp_hint_pack', 'chat') : null;
}

function fresh(p, since, upTo) {
    const l = (p.items || []).filter(x => x && x.t > since && x.t <= upTo), cap = p.fcap || 1300, out = [];
    let n = 0;
    for (let i = l.length - 1; i >= 0 && out.length < 25; i--) {
        n += String(l[i].x).length + 3;
        if (n > cap && out.length) break;
        out.unshift(l[i].x);
    }
    return out;
}

function block(p, list) {
    return '[ТЕЛЕФОН — фон для рассказчика, не реплика игрока. Не пересказывай и не реагируй на всё сразу: используй только то, что к месту в сцене.]\n' +
        (list.length ? 'Новое с прошлого хода:\n' + list.map(x => '- ' + x).join('\n') + '\n' : '') +
        (p.state ? 'Сейчас в телефоне:\n' + p.state + '\n' : '') +
        '[/ТЕЛЕФОН]';
}

function lastUserText() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && m.is_user && !m.is_system) return String(m.mes || '');
    }
    return '';
}

async function prepare(type, params, dry) {
    put('');
    if (dry || type === 'quiet' || type === 'impersonate' || type === 'continue') return;
    if (!window.PM) return;
    try {
        const conf = window.PM.store.get('rp_hint_conf', 'global');
        if (!conf || !conf.on) return;
        const text = lastUserText();
        if (!text.trim()) return;
        const p = await pack();
        if (!p || (!p.state && !(p.items || []).length)) return;
        const key = hash(String(ctx().chatId || '') + '|' + text);
        let mark = window.PM.store.get('rp_hint_mark', 'chat');
        if (!mark || mark.key !== key) {
            mark = { key, since: mark && mark.upTo ? mark.upTo : Date.now(), upTo: Date.now() };
            window.PM.store.set('rp_hint_mark', mark, 'chat');
        }
        const list = fresh(p, mark.since, mark.upTo);
        const out = block(p, list);
        put(out);
        window.PM.store.set('rp_hint_last', { at: Date.now(), chars: out.length, fresh: list.length, type: type || '' }, 'chat');
    } catch (e) {
        console.error('[PHONE MOUSE] hint', e);
    }
}

export function installHint() {
    const c = ctx();
    c.eventSource.on(c.eventTypes.GENERATION_STARTED, prepare);
    c.eventSource.on(c.eventTypes.GENERATION_ENDED, () => put(''));
    c.eventSource.on(c.eventTypes.GENERATION_STOPPED, () => put(''));
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => put(''));
}
