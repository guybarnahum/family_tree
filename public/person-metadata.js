// Slice C person-metadata helpers shared by the pane and its save path.
// Places preserve the exact human-entered text. countryCode is presentation metadata only:
// infer it conservatively, and omit the flag rather than guessing an ambiguous place.
(function installPersonMetadata(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FamilyPersonMetadata = api;
})(typeof window !== 'undefined' ? window : globalThis, function personMetadataFactory() {
    const ISO_CODES = `AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW`.split(/\s+/);

    const US_STATES = [
        ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
        ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'],
        ['Florida', 'FL'], ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'],
        ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'], ['Kentucky', 'KY'],
        ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'], ['Massachusetts', 'MA'],
        ['Michigan', 'MI'], ['Minnesota', 'MN'], ['Mississippi', 'MS'], ['Missouri', 'MO'],
        ['Montana', 'MT'], ['Nebraska', 'NE'], ['Nevada', 'NV'], ['New Hampshire', 'NH'],
        ['New Jersey', 'NJ'], ['New Mexico', 'NM'], ['New York', 'NY'], ['North Carolina', 'NC'],
        ['North Dakota', 'ND'], ['Ohio', 'OH'], ['Oklahoma', 'OK'], ['Oregon', 'OR'],
        ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'], ['South Carolina', 'SC'],
        ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'],
        ['Vermont', 'VT'], ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'],
        ['Wisconsin', 'WI'], ['Wyoming', 'WY'], ['District of Columbia', 'DC']
    ];
    const US_ABBREVIATIONS = new Set(US_STATES.map(([, code]) => code));

    const EXPLICIT_ALIASES = [
        ['United States of America', 'US'], ['United States', 'US'], ['U.S.A.', 'US'], ['USA', 'US'],
        ['ארצות הברית', 'US'], ['ארה״ב', 'US'], ['ארה"ב', 'US'],
        ['Israel', 'IL'], ['ישראל', 'IL'],
        ['United Kingdom', 'GB'], ['UK', 'GB'], ['Britain', 'GB'], ['Great Britain', 'GB'], ['בריטניה', 'GB'],
        ['Palestine', 'PS'], ['פלסטין', 'PS'],
        ['Yemen', 'YE'], ['תימן', 'YE'],
        ['Poland', 'PL'], ['פולין', 'PL']
    ];

    const AMBIGUOUS_REGION_NAMES = new Set(['georgia']);
    let localizedAliases = null;

    function normalized(value) {
        return String(value ?? '').trim().toLocaleLowerCase();
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function containsPhrase(haystack, phrase) {
        const target = normalized(phrase);
        if (!target) return false;
        const escaped = escapeRegExp(target).replace(/\s+/g, '\\s+');
        return new RegExp(`(?:^|[\\s,;:/()\\-])${escaped}(?:$|[\\s,;:/()\\-])`, 'iu').test(haystack);
    }

    function countryAliases() {
        if (localizedAliases) return localizedAliases;
        const aliases = [...EXPLICIT_ALIASES];
        if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
            for (const locale of ['en', 'he']) {
                try {
                    const display = new Intl.DisplayNames([locale], { type: 'region' });
                    for (const code of ISO_CODES) {
                        const name = display.of(code);
                        if (!name || AMBIGUOUS_REGION_NAMES.has(normalized(name))) continue;
                        aliases.push([name, code]);
                    }
                } catch (_) {}
            }
        }

        const unique = new Map();
        for (const [name, code] of aliases) {
            const key = normalized(name);
            if (!key || AMBIGUOUS_REGION_NAMES.has(key)) continue;
            if (!unique.has(key)) unique.set(key, [name, code]);
        }
        localizedAliases = [...unique.values()].sort((a, b) => b[0].length - a[0].length);
        return localizedAliases;
    }

    function inferCountryCode(value) {
        const text = normalized(value);
        if (!text) return null;

        for (const [name, code] of countryAliases()) {
            if (containsPhrase(text, name)) return code;
        }

        // A full U.S. state name is a strong country signal. Georgia is intentionally absent
        // because it is also a country and should not be guessed from the word alone.
        for (const [state] of US_STATES) {
            if (containsPhrase(text, state)) return 'US';
        }

        // Postal-state abbreviations are only treated as U.S. when used in the conventional
        // comma-suffixed place form, optionally followed by a ZIP code.
        const abbreviation = String(value).match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
        if (abbreviation && US_ABBREVIATIONS.has(abbreviation[1].toUpperCase())) return 'US';

        return null;
    }

    function flagEmoji(countryCode) {
        const code = String(countryCode || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) return '';
        return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
    }

    function countryName(countryCode, locale = 'he') {
        const code = String(countryCode || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) return '';
        try {
            return new Intl.DisplayNames([locale || 'he'], { type: 'region' }).of(code) || code;
        } catch (_) {
            return code;
        }
    }

    function placeText(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'object' && !Array.isArray(value)) return String(value.text ?? '').trim();
        return '';
    }

    function placeCountryCode(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return inferCountryCode(placeText(value));
        const stored = String(value.countryCode || '').trim().toUpperCase();
        return /^[A-Z]{2}$/.test(stored) ? stored : inferCountryCode(placeText(value));
    }

    function placeFromText(value) {
        const text = String(value ?? '').trim();
        if (!text) return null;
        const countryCode = inferCountryCode(text);
        return countryCode ? { text, countryCode } : { text };
    }

    function metadataObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function withField(metadata, key, value, kind = 'text') {
        const next = { ...metadataObject(metadata) };
        if (kind === 'place') {
            const place = placeFromText(value);
            if (place) next[key] = place;
            else delete next[key];
            return next;
        }

        const text = String(value ?? '').trim();
        if (text) next[key] = text;
        else delete next[key];
        return next;
    }

    return {
        inferCountryCode,
        flagEmoji,
        countryName,
        placeText,
        placeCountryCode,
        placeFromText,
        metadataObject,
        withField
    };
});
