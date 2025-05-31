// src/utils/i18n.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, '..', 'locales');
const translations = {};

try {
    const enTranslations = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf-8'));
    translations.en = enTranslations;
} catch (error) {
    console.error("Failed to load English translations:", error);
    translations.en = {};
}

try {
    const arTranslations = JSON.parse(fs.readFileSync(path.join(localesDir, 'ar.json'), 'utf-8'));
    translations.ar = arTranslations;
} catch (error) {
    console.error("Failed to load Arabic translations:", error);
    translations.ar = {};
}


const getLanguage = (req) => {
    // Prioritize 'lang' query parameter, then 'Accept-Language' header
    const langQuery = req.query.lang;
    const acceptLanguageHeader = req.headers['accept-language'];
    let preferredLang = 'en'; // Default language

    if (langQuery && translations[langQuery]) {
        preferredLang = langQuery;
    } else if (acceptLanguageHeader) {
        const languages = acceptLanguageHeader.split(',').map(lang => lang.split(';')[0].toLowerCase());
        if (languages.includes('ar') && translations.ar) {
            preferredLang = 'ar';
        }
    }
    return preferredLang;
};

const translate = (key, lang, options = {}) => {
    if (!translations[lang]) {
        console.warn(`Language "${lang}" not found. Falling back to English.`);
        lang = 'en';
    }
    const langTranslations = translations[lang];
    let message = langTranslations[key] || translations.en[key] || key; // Fallback to key if not found

    // Replace placeholders like {{variable}}
    for (const placeholder in options) {
        message = message.replace(new RegExp(`{{${placeholder}}}`, 'g'), options[placeholder]);
    }
    return message;
};

export { getLanguage, translate };