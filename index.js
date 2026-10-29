import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, updateMessageBlock, saveChatConditional } from '../../../../script.js';

const MODULE = 'roleplay_leash';

const defaults = {
    enabled: true,
    fixChar: true,
    fixUser: true,
    dashToQuotes: true,
    fixOnEdit: true,
    customColors: false,
    dialogueColor: '#ffd37a',
    actionColor: '#a8b8d8'
};

let busy = false;

function getSettings() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = {};
    }
    for (const k of Object.keys(defaults)) {
        if (extension_settings[MODULE][k] === undefined) {
            extension_settings[MODULE][k] = defaults[k];
        }
    }
    return extension_settings[MODULE];
}

function wrapDialogue(text) {
    const core = text.trim();
    const trail = text.match(/\s*$/)[0];
    return '"' + core + '"' + trail;
}

function fixLine(line, s) {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (/^(<|#|>|\||---|___|\[|\(\(|\/|\{\{)/.test(trimmed)) return line;
    if (/^[*_\-=~\s]+$/.test(trimmed)) return line;

    let work = line.replace(/[“”„«»]/g, '"');

    if (s.dashToQuotes) {
        work = work.replace(/^(\s*)[-–—]\s*([^*"\n]+)/, (m, a, b) => a + wrapDialogue(b));
        work = work.replace(/([*.!?…])(\s*)[-–—]\s+([^*"\n]+)/g, (m, a, sp, b) => a + sp + wrapDialogue(b));
    }

    const quoteCount = (work.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) return line;

    return work.split(/("[^"]*")/).map(part => {
        if (part.length >= 2 && part.startsWith('"') && part.endsWith('"')) {
            return '"' + part.slice(1, -1).replace(/\*+/g, '') + '"';
        }
        const clean = part.replace(/\*+/g, '');
        if (!/[\p{L}\p{N}]/u.test(clean)) return clean;
        const lead = clean.match(/^\s*/)[0];
        const trail = clean.match(/\s*$/)[0];
        return lead + '*' + clean.trim() + '*' + trail;
    }).join('');
}

function fixText(text, s) {
    if (!text || typeof text !== 'string') return text;
    if (/^\s*\//.test(text)) return text;
    let inFence = false;
    return text.split('\n').map(line => {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            return line;
        }
        if (inFence) return line;
        return fixLine(line, s);
    }).join('\n');
}

function applyFixToMessage(msg, s) {
    if (!msg || msg.is_system) return false;
    if (msg.is_user && !s.fixUser) return false;
    if (!msg.is_user && !s.fixChar) return false;
    const fixed = fixText(msg.mes, s);
    if (fixed === msg.mes) return false;
    msg.mes = fixed;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = fixed;
    }
    return true;
}

function onMessageSent(id) {
    const s = getSettings();
    if (!s.enabled) return;
    const msg = getContext().chat[id];
    applyFixToMessage(msg, s);
}

function onMessageRendered(id) {
    const s = getSettings();
    if (!s.enabled || busy) return;
    const msg = getContext().chat[id];
    if (!msg || msg.is_user) return;
    if (applyFixToMessage(msg, s)) {
        busy = true;
        try {
            updateMessageBlock(Number(id), msg);
            saveChatConditional();
        } finally {
            busy = false;
        }
    }
}

function onMessageEdited(id) {
    const s = getSettings();
    if (!s.enabled || !s.fixOnEdit || busy) return;
    const msg = getContext().chat[id];
    if (applyFixToMessage(msg, s)) {
        busy = true;
        try {
            updateMessageBlock(Number(id), msg);
            saveChatConditional();
        } finally {
            busy = false;
        }
    }
}

async function fixWholeChat() {
    const s = getSettings();
    const chat = getContext().chat;
    let count = 0;
    busy = true;
    try {
        for (let i = 0; i < chat.length; i++) {
            if (applyFixToMessage(chat[i], s)) {
                count++;
                updateMessageBlock(i, chat[i]);
            }
        }
        if (count > 0) await saveChatConditional();
    } finally {
        busy = false;
    }
    toastr.success(count + ' mensagem(ns) corrigida(s).', 'Roleplay Leash');
}

function applyColors() {
    const s = getSettings();
    $('#rl_style').remove();
    if (!s.enabled || !s.customColors) return;
    const css = `.mes_text q{color:${s.dialogueColor} !important;}.mes_text em{color:${s.actionColor} !important;}`;
    $('<style id="rl_style"></style>').text(css).appendTo('head');
}

function buildUI() {
    const s = getSettings();
    const html = `
    <div class="roleplay-leash-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Roleplay Leash</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_enabled" ${s.enabled ? 'checked' : ''}>
                    <span>Ativar</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_fixchar" ${s.fixChar ? 'checked' : ''}>
                    <span>Corrigir mensagens do LLM</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_fixuser" ${s.fixUser ? 'checked' : ''}>
                    <span>Corrigir minhas mensagens (antes de enviar)</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_dash" ${s.dashToQuotes ? 'checked' : ''}>
                    <span>Converter falas com "-" / "—" em aspas</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_edit" ${s.fixOnEdit ? 'checked' : ''}>
                    <span>Corrigir também ao editar mensagens</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_colors" ${s.customColors ? 'checked' : ''}>
                    <span>Usar cores personalizadas</span>
                </label>
                <label for="rl_dcolor">Cor do diálogo</label>
                <input type="color" id="rl_dcolor" value="${s.dialogueColor}">
                <label for="rl_acolor">Cor da ação / narração</label>
                <input type="color" id="rl_acolor" value="${s.actionColor}">
                <div class="menu_button" id="rl_fixall">Corrigir chat inteiro agora</div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#rl_enabled').on('change', function () {
        s.enabled = this.checked;
        saveSettingsDebounced();
        applyColors();
    });
    $('#rl_fixchar').on('change', function () {
        s.fixChar = this.checked;
        saveSettingsDebounced();
    });
    $('#rl_fixuser').on('change', function () {
        s.fixUser = this.checked;
        saveSettingsDebounced();
    });
    $('#rl_dash').on('change', function () {
        s.dashToQuotes = this.checked;
        saveSettingsDebounced();
    });
    $('#rl_edit').on('change', function () {
        s.fixOnEdit = this.checked;
        saveSettingsDebounced();
    });
    $('#rl_colors').on('change', function () {
        s.customColors = this.checked;
        saveSettingsDebounced();
        applyColors();
    });
    $('#rl_dcolor').on('input', function () {
        s.dialogueColor = this.value;
        saveSettingsDebounced();
        applyColors();
    });
    $('#rl_acolor').on('input', function () {
        s.actionColor = this.value;
        saveSettingsDebounced();
        applyColors();
    });
    $('#rl_fixall').on('click', fixWholeChat);
}

jQuery(() => {
    getSettings();
    buildUI();
    applyColors();
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
});
