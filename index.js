import { settings, install, selfTest, fail } from './core.js';

const BASE = new URL('./', import.meta.url).href;
const VERSION = '1.0.1';
let mountTimer = null;
let mounting = false;
let status = 'не запускался';
let cache = null;

function ctx() {
    return SillyTavern.getContext();
}

function setStatus(text) {
    status = text;
    const el = document.getElementById('pm_status');
    if (el) el.textContent = text;
}

async function loadParts() {
    if (cache) return cache;
    const res = await fetch(BASE + 'phone.html?v=' + VERSION, { cache: 'no-store' });
    if (!res.ok) throw new Error('phone.html → ' + res.status);
    cache = await res.text();
    return cache;
}

function unmount() {
    window.__rpPhoneGen = (window.__rpPhoneGen || 0) + 1;
    document.querySelectorAll('#pm_host, script[data-pm]').forEach(n => n.remove());
}

function ensureCss() {
    if (document.getElementById('pm_css')) return;
    const link = document.createElement('link');
    link.id = 'pm_css';
    link.rel = 'stylesheet';
    link.href = BASE + 'phone.css?v=' + VERSION;
    document.head.appendChild(link);
    const own = document.createElement('style');
    own.id = 'pm_css_own';
    own.textContent = '#pm_host{position:fixed;left:0;top:0;width:100vw;height:100dvh;transform:translateZ(0);pointer-events:none;z-index:10040}#pm_host #rp_root,#pm_host #rp_phone_wrap,#pm_host .wg_lightbox{pointer-events:auto}#pm_host #rp_root{position:fixed;z-index:10041}#pm_host #rp_toggle{width:38px;height:38px;opacity:.92;background:rgba(24,20,36,.92);border-color:rgba(255,111,174,.8)}#pm_host #rp_toggle svg{width:19px;height:19px}';
    document.head.appendChild(own);
}

async function mount() {
    if (mounting) return;
    mounting = true;
    try {
        unmount();
        if (!settings().enabled) return setStatus('выключен в настройках');
        if (!ctx().chatId) return setStatus('нет открытого чата');
        ensureCss();
        const markup = await loadParts();
        const host = document.createElement('div');
        host.id = 'pm_host';
        host.innerHTML = markup;
        const root = host.querySelector('#rp_root');
        if (root) {
            root.style.right = '10px';
            root.style.bottom = '170px';
        }
        document.body.appendChild(host);
        const onErr = ev => fail('ошибка в телефоне', ev.message || ev.error);
        window.addEventListener('error', onErr);
        setTimeout(() => window.removeEventListener('error', onErr), 6000);
        const sc = document.createElement('script');
        sc.setAttribute('data-pm', '1');
        sc.src = BASE + 'app.js?v=' + VERSION + '&t=' + Date.now();
        sc.onerror = () => fail('не загрузился app.js', 'проверь, что папка расширения целая');
        document.body.appendChild(sc);
        watchFit();
        setTimeout(freeToggle, 1800);
        setTimeout(freeToggle, 5000);
        setStatus('работает');
    } catch (e) {
        fail('не удалось запустить телефон', e);
        setStatus('ошибка: ' + (e && e.message ? e.message : e));
    } finally {
        mounting = false;
    }
}

function mountSoon() {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(mount, 400);
}

function freeToggle() {
    const root = document.getElementById('rp_root');
    const t = document.getElementById('rp_toggle');
    if (!root || !t) return;
    for (let i = 0; i < 8; i++) {
        const r = t.getBoundingClientRect();
        if (r.width === 0) return;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top || t === top || t.contains(top)) return;
        root.style.bottom = (parseFloat(root.style.bottom) || 110) + 52 + 'px';
    }
}

function fit() {
    const wrap = document.getElementById('rp_phone_wrap');
    const frame = document.getElementById('rp_frame');
    if (!wrap || !frame) return;
    const vv = window.visualViewport;
    const vw = vv ? vv.width : innerWidth;
    const vh = vv ? vv.height : innerHeight;
    const ox = vv ? vv.offsetLeft : 0;
    const oy = vv ? vv.offsetTop : 0;
    const mobile = vw < 700;
    const compact = mobile || vh < 560;
    const AW = vw - 16;
    const AH = compact ? vh - 20 : vh - 82;
    const pick = Number(settings().phoneScale) || 0;
    let z = pick ? pick / 100 : mobile ? Math.min(Math.max(AW / 320, 1), 1.4) : Math.min(Math.max(AH / 592, 1), 1.5);
    z = Math.max(0.8, Math.min(z, AW / 320, AH / 380));
    const H = Math.max(380, Math.min(AH / z, mobile ? 900 : 592));
    frame.style.setProperty('width', '320px', 'important');
    frame.style.setProperty('height', H + 'px', 'important');
    frame.style.setProperty('max-height', 'none', 'important');
    frame.style.setProperty('zoom', String(z), 'important');
    const w = 320 * z;
    const h = H * z;
    if (compact) {
        wrap.style.setProperty('left', Math.round(ox + (vw - w) / 2) + 'px', 'important');
        wrap.style.setProperty('top', Math.round(oy + (vh - h) / 2) + 'px', 'important');
        wrap.style.setProperty('right', 'auto', 'important');
        wrap.style.setProperty('bottom', 'auto', 'important');
    } else {
        wrap.style.setProperty('left', 'auto', 'important');
        wrap.style.setProperty('top', 'auto', 'important');
        wrap.style.setProperty('right', '16px', 'important');
        wrap.style.setProperty('bottom', '66px', 'important');
    }
}

let fitObserver = null;
function watchFit() {
    if (fitObserver) fitObserver.disconnect();
    const wrap = document.getElementById('rp_phone_wrap');
    if (!wrap) return;
    fitObserver = new MutationObserver(fit);
    fitObserver.observe(wrap, { attributes: true, attributeFilter: ['style'] });
    fit();
}

function watchdog() {
    if (mounting || !settings().enabled) return;
    if (document.getElementById('pm_host')) return;
    if (!ctx().chatId) return;
    mount();
}

async function openPhone() {
    if (!document.getElementById('pm_host')) await mount();
    setTimeout(() => document.dispatchEvent(new CustomEvent('rp-phone:open')), 150);
    setTimeout(fit, 250);
}

function addSettingsUi() {
    const host = document.getElementById('extensions_settings2');
    if (!host || document.getElementById('pm_settings')) return;
    const s = settings();
    const wrap = document.createElement('div');
    wrap.id = 'pm_settings';
    wrap.className = 'extension_container';
    wrap.innerHTML =
        '<div class="inline-drawer">' +
        '<div class="inline-drawer-toggle inline-drawer-header"><b>PHONE MOUSE</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
        '<div class="inline-drawer-content">' +
        '<label class="checkbox_label"><input type="checkbox" data-k="enabled"><span>Включить телефон</span></label>' +
        '<div class="menu_button" id="pm_open_btn">Открыть телефон</div>' +
        '<label>Размер телефона</label><select class="text_pole" data-k="phoneScale"><option value="0">Авто по экрану</option><option value="80">80%</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="175">175%</option></select>' +
        '<div class="menu_button" id="pm_diag_btn">Диагностика</div>' +
        '<small>Статус: <span id="pm_status"></span></small>' +
        '<textarea class="text_pole" id="pm_diag_out" rows="10" style="display:none;font-size:11px;white-space:pre;" readonly></textarea>' +
        '<label>Сколько сообщений чата видит нейросеть: <b data-v="contextRange"></b></label><input type="range" class="neo-range-slider" data-k="contextRange" min="4" max="20" step="2">' +
        '<label class="checkbox_label"><input type="checkbox" data-k="refreshOnOpen"><span>Умный разбор при открытии телефона</span></label>' +
        '<label class="checkbox_label"><input type="checkbox" data-k="autoScan"><span>Умный разбор сам, пока играешь</span></label>' +
        '<label>Авторазбор: раз в N новых сообщений: <b data-v="scanEvery"></b></label><input type="range" class="neo-range-slider" data-k="scanEvery" min="2" max="30" step="1">' +
        '<label>Разбор: сколько сообщений истории читать: <b data-v="scanDepth"></b></label><input type="range" class="neo-range-slider" data-k="scanDepth" min="5" max="100" step="5">' +
        '</div></div>';
    host.appendChild(wrap);
    wrap.querySelector('#pm_open_btn').addEventListener('click', openPhone);
    wrap.querySelector('#pm_status').textContent = status;
    wrap.querySelector('#pm_diag_btn').addEventListener('click', async () => {
        const out = wrap.querySelector('#pm_diag_out');
        out.style.display = 'block';
        out.value = 'проверяю…';
        try { out.value = await selfTest(); } catch (e) { out.value = 'сбой диагностики: ' + (e && e.message ? e.message : e); }
        out.focus();
        out.select();
    });
    wrap.querySelectorAll('[data-k]').forEach(inp => {
        const k = inp.getAttribute('data-k');
        const label = wrap.querySelector('[data-v="' + k + '"]');
        if (inp.type === 'checkbox') inp.checked = !!s[k];
        else {
            inp.value = s[k];
            if (label) label.textContent = s[k];
        }
        inp.addEventListener('input', () => {
            if (inp.type === 'checkbox') s[k] = inp.checked;
            else {
                s[k] = Number(inp.value);
                if (label) label.textContent = inp.value;
            }
            ctx().saveSettingsDebounced();
            if (k === 'enabled') mountSoon();
            if (k === 'phoneScale') fit();
        });
    });
}

function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('pm_open')) return;
    const item = document.createElement('div');
    item.id = 'pm_open';
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = '<div class="fa-solid fa-mobile-screen extensionsMenuExtensionButton"></div><span>Телефон</span>';
    item.addEventListener('click', openPhone);
    menu.appendChild(item);
}

jQuery(async () => {
    install();
    settings();
    addSettingsUi();
    addMenuItem();
    const c = ctx();
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, mountSoon);
    c.eventSource.on(c.eventTypes.APP_READY, mountSoon);
    mountSoon();
    setInterval(watchdog, 3000);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 300));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fit);
        window.visualViewport.addEventListener('scroll', fit);
    }
});
