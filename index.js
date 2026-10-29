import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

const MODULE = 'roleplay_leash';
const KEY_MAIN = 'roleplay_leash_main';
const KEY_SHORT = 'roleplay_leash_short';

const DEFAULT_MAIN = [
    '[MANDATORY FORMATTING RULES - THESE OVERRIDE ANY OTHER STYLE HABIT AND MUST BE FOLLOWED IN EVERY SINGLE REPLY, FROM FIRST TO LAST LINE:',
    '1. Every spoken line of dialogue goes inside double quotes: "like this".',
    '2. Every action, movement, gesture, thought, description and narration goes inside single asterisks: *like this*.',
    '3. Never write plain unformatted text. Every piece of text must be either inside "quotes" or inside *asterisks*.',
    '4. Never put dialogue inside asterisks and never put actions inside quotes. Close the asterisks before opening the quotes.',
    '5. Keep this formatting consistent for the entire roleplay, no matter how long it gets. Never drop it, even if previous messages did not follow it.',
    'Example: *She turns around and smiles.* "I was waiting for you." *She steps closer, lowering her voice.* "Did you bring it?"',
    'Write in the same language as the conversation.]'
].join('\n');

const DEFAULT_SHORT = '[Reminder: dialogue ALWAYS in "quotes", actions/narration/thoughts ALWAYS in *asterisks*. No plain text. Keep this format in this reply.]';

const defaults = {
    enabled: true,
    autofix: true,
    reminder: true,
    mainPrompt: DEFAULT_MAIN,
    shortPrompt: DEFAULT_SHORT,
    depth: 4
};

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

function applyPrompts() {
    const s = getSettings();
    const ctx = getContext();
    const IN_CHAT = 1;
    const ROLE_SYSTEM = 0;
    if (s.enabled) {
        ctx.setExtensionPrompt(KEY_MAIN, s.mainPrompt, IN_CHAT, Number(s.depth) || 4, false, ROLE_SYSTEM);
        ctx.setExtensionPrompt(KEY_SHORT, s.reminder ? s.shortPrompt : '', IN_CHAT, 0, false, ROLE_SYSTEM);
    } else {
        ctx.setExtensionPrompt(KEY_MAIN, '', IN_CHAT, 4, false, ROLE_SYSTEM);
        ctx.setExtensionPrompt(KEY_SHORT, '', IN_CHAT, 0, false, ROLE_SYSTEM);
    }
}

function fixLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (/^(```|<|#|---|___|\|)/.test(trimmed)) return line;

    let clean = line.replace(/[“”„«»]/g, '"').replace(/\*+/g, '');
    const quotes = (clean.match(/"/g) || []).length;
    if (quotes % 2 !== 0) return line;

    const parts = clean.split(/("[^"]*")/);
    return parts.map(part => {
        if (part.startsWith('"') && part.endsWith('"') && part.length >= 2) return part;
        if (!/[\p{L}\p{N}]/u.test(part)) return part;
        const lead = part.match(/^\s*/)[0];
        const trail = part.match(/\s*$/)[0];
        const core = part.trim();
        return `${lead}*${core}*${trail}`;
    }).join('');
}

function fixText(text) {
    if (!text || text.includes('```')) return text;
    return text.split('\n').map(fixLine).join('\n');
}

function onMessageReceived(id) {
    const s = getSettings();
    if (!s.enabled || !s.autofix) return;
    const ctx = getContext();
    const msg = ctx.chat[id];
    if (!msg || msg.is_user || msg.is_system) return;
    const fixed = fixText(msg.mes);
    if (fixed !== msg.mes) {
        msg.mes = fixed;
        if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) {
            msg.swipes[msg.swipe_id] = fixed;
        }
    }
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
                    <input type="checkbox" id="rl_autofix" ${s.autofix ? 'checked' : ''}>
                    <span>Corrigir automaticamente as respostas</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="rl_reminder" ${s.reminder ? 'checked' : ''}>
                    <span>Lembrete curto no final de cada prompt</span>
                </label>
                <label for="rl_depth">Profundidade das regras principais</label>
                <input type="number" id="rl_depth" class="text_pole" min="0" max="50" value="${s.depth}">
                <label for="rl_main">Regras principais</label>
                <textarea id="rl_main" class="text_pole textarea_compact" rows="8"></textarea>
                <label for="rl_short">Lembrete curto</label>
                <textarea id="rl_short" class="text_pole textarea_compact" rows="3"></textarea>
                <div class="menu_button" id="rl_reset">Restaurar padrão</div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);
    $('#rl_main').val(s.mainPrompt);
    $('#rl_short').val(s.shortPrompt);

    $('#rl_enabled').on('change', function () {
        s.enabled = this.checked;
        saveSettingsDebounced();
        applyPrompts();
    });
    $('#rl_autofix').on('change', function () {
        s.autofix = this.checked;
        saveSettingsDebounced();
    });
    $('#rl_reminder').on('change', function () {
        s.reminder = this.checked;
        saveSettingsDebounced();
        applyPrompts();
    });
    $('#rl_depth').on('input', function () {
        s.depth = Number(this.value) || 0;
        saveSettingsDebounced();
        applyPrompts();
    });
    $('#rl_main').on('input', function () {
        s.mainPrompt = this.value;
        saveSettingsDebounced();
        applyPrompts();
    });
    $('#rl_short').on('input', function () {
        s.shortPrompt = this.value;
        saveSettingsDebounced();
        applyPrompts();
    });
    $('#rl_reset').on('click', function () {
        s.mainPrompt = DEFAULT_MAIN;
        s.shortPrompt = DEFAULT_SHORT;
        s.depth = defaults.depth;
        $('#rl_main').val(s.mainPrompt);
        $('#rl_short').val(s.shortPrompt);
        $('#rl_depth').val(s.depth);
        saveSettingsDebounced();
        applyPrompts();
    });
}

jQuery(() => {
    getSettings();
    buildUI();
    applyPrompts();
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.CHAT_CHANGED, applyPrompts);
    eventSource.on(event_types.GENERATION_STARTED, applyPrompts);
});
