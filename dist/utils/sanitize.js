const CSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const ESC_PATTERN = /\x1B[@-Z\\-_]/g;
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g;
/** Remove terminal control sequences and direction-changing characters. */
export function sanitizeTerminalText(value, maxLength) {
    if (typeof value !== 'string') {
        return '';
    }
    const sanitized = value
        .replace(CSI_PATTERN, '')
        .replace(OSC_PATTERN, '')
        .replace(ESC_PATTERN, '')
        .replace(CONTROL_AND_BIDI_PATTERN, '');
    return maxLength === undefined ? sanitized : sanitized.slice(0, Math.max(0, maxLength));
}
//# sourceMappingURL=sanitize.js.map