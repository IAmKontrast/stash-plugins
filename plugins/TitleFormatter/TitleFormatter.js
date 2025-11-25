"use strict";

(function () {

    var TITLE_FORMATTER_KEY = "TitleFormatter";
    var _settingsCache = null;

    const api = window.PluginApi;
    if (!api || !api.patch) {
        console.warn("[TitleFormatter] PluginApi.patch not available");
        return;
    }

    const { patch } = api;

    // Double / single quote variants
    const DOUBLE_QUOTE_CHARS = "\"“”„‟〝〞〟⹂⹃⹄";
    const SINGLE_QUOTE_CHARS = "’‘‚‛`´′ˈʻʼʽʾʿˊˋ＇";

    // Binding words used around performer names
    const PERFORMER_BINDING_WORDS = [
        "&",
        "and",
        "as",
        "by",
        "feat",
        "feat.",
        "featuring",
        "from",
        "ft",
        "ft.",
        "in",
        "is",
        "like",
        "on",
        "or",
        "original",
        "performed by",
        "presented by",
        "presents",
        "produced by",
        "remixed by",
        "starring",
        "version",
        "versus",
        "vocal",
        "vs",
        "vs.",
        "w/",
        "with",
        "written by"
    ];

    async function getSettings() {

        var defaultSettings = {
            runAlways: false,
            normalizeAllQuotes: false,
            removeAllDoubleQuotes: false,
            trimWhitespace: false,
            collapseWhitespace: false,
            removeEdgePunctuation: false,
            removeSeasonEpisode: false,
            removePerformerNames: false,
            preserveCasePattern: "",
            casingMode: "",
            possessiveBaseTerms: "",
            smartPossessive: false,
            customReplacePairs: ""
        };

        if (typeof csLib === "undefined" || !csLib.getConfiguration) {
            console.warn("[TitleFormatter] csLib not available, using defaults only");
            return Promise.resolve(defaultSettings);
        }

        if (_settingsCache) {
            return Promise.resolve(_settingsCache);
        }

        return await csLib.getConfiguration(TITLE_FORMATTER_KEY, defaultSettings)
            .then(function (cfg) {
                _settingsCache = {
                    runAlways: !!cfg.runAlways,
                    normalizeAllQuotes: !!cfg.normalizeAllQuotes,
                    removeAllDoubleQuotes: !!cfg.removeAllDoubleQuotes,
                    trimWhitespace: !!cfg.trimWhitespace,
                    collapseWhitespace: !!cfg.collapseWhitespace,
                    removeEdgePunctuation: !!cfg.removeEdgePunctuation,
                    removeSeasonEpisode: !!cfg.removeSeasonEpisode,
                    removePerformerNames: !!cfg.removePerformerNames,
                    preserveCasePattern: String(cfg.preserveCasePattern || "").trim(),
                    casingMode: String(cfg.casingMode || "").trim(),
                    possessiveBaseTerms: String(cfg.possessiveBaseTerms || "").trim(),
                    smartPossessive: !!cfg.smartPossessive,
                    customReplacePairs: String(cfg.customReplacePairs || "").trim()
                };
                return _settingsCache;
            });
    }

    // --- DOM helpers ----------------------------------------------------------

    function isSceneOrganized() {
        var organizedButton = document.querySelector(
            "button.organized-button.organized"
        );
        return !!organizedButton;
    }

    function getTitleInput() {
        return (
            document.querySelector('input[name="title"]') ||
            document.querySelector("input#title")
        );
    }

    function getPerformerNamesFromPage() {
        const names = new Set();
        const nodes = document.querySelectorAll(
            ".performer-select-value > span:first-child"
        );
        nodes.forEach((span) => {
            const name = span && span.textContent ? span.textContent.trim() : "";
            if (name) names.add(name);
        });
        return Array.from(names);
    }

    // --- Generic string helpers ----------------------------------------------

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function parseReplacePairs(raw) {
        if (!raw || typeof raw !== "string" || !raw.trim()) return [];
        try {
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return [];
            return data
                .filter((p) => Array.isArray(p) && p.length >= 2)
                .map(([from, to]) => ({ from: String(from), to: String(to) }));
        } catch (error) {
            console.warn("[TitleFormatter] Invalid customReplacePairs JSON:", error);
            return [];
        }
    }

    function applyReplacePairs(value, pairs) {
        let result = value;
        for (const { from, to } of pairs) {
            if (!from) continue;

            const regexLike = from.match(/^\/(.+)\/([a-z]*)$/i);
            if (regexLike) {
                const pattern = regexLike[1];
                const flagsRaw = regexLike[2] || "";
                const flags = flagsRaw.includes("g") ? flagsRaw : flagsRaw + "g";
                try {
                    const re = new RegExp(pattern, flags);
                    result = result.replace(re, to);
                } catch (error) {
                    console.warn("[TitleFormatter] Invalid custom regex:", from, error);
                }
            } else {
                const reText = new RegExp(escapeRegex(from), "g");
                result = result.replace(reText, to);
            }
        }
        return result;
    }

    function hasMeaningfulContent(str) {
        if (!str) return false;
        let s = str.trim();
        if (!s) return false;
        s = s.replace(/[\s\-–—:;,.!?'"…]+/g, "");
        return s.length > 0;
    }

    // --- Quotes normalization / Removal --------------------------------------

    function applyQuoteNormalization(value, settings) {
        let result = value;

        if (settings.normalizeAllQuotes) {
            const doubleRe = new RegExp("[" + DOUBLE_QUOTE_CHARS + "]", "g");
            const singleRe = new RegExp("[" + SINGLE_QUOTE_CHARS + "]", "g");
            result = result.replace(doubleRe, "\"");
            result = result.replace(singleRe, "'");
        }

        if (settings.removeAllDoubleQuotes) {
            const allDouble = new RegExp("[" + DOUBLE_QUOTE_CHARS + "]", "g");
            result = result.replace(allDouble, "");
        }

        return result;
    }

    // --- Performer name removal ----------------------------------------------

    function removePerformerNames(value, performerNames) {
        if (!performerNames || performerNames.length === 0) {
            return { value: value, changed: false };
        }

        var original = value;
        var result = value;

        for (var i = 0; i < performerNames.length; i++) {
            var fullName = performerNames[i];
            var trimmedName = fullName && fullName.trim();
            if (!trimmedName) continue;

            var fullEsc = escapeRegex(trimmedName);

            // 1) Full name + 's
            var possessiveFullRe = new RegExp(
                "\\b" + fullEsc + "\\s*['’]s\\b",
                "gi"
            );
            result = result.replace(possessiveFullRe, " ");

            // 2) Full name + binding word
            for (var b = 0; b < PERFORMER_BINDING_WORDS.length; b++) {
                var bw = PERFORMER_BINDING_WORDS[b];
                var bwEsc = escapeRegex(bw);

                // Before
                var patternBefore = "\\b" + bwEsc + "\\s+" + fullEsc + "\\b";
                var reBefore = new RegExp(patternBefore, "gi");
                result = result.replace(reBefore, " ");

                // After
                var patternAfter = "\\b" + fullEsc + "\\s+" + bwEsc + "\\b";
                var reAfter = new RegExp(patternAfter, "gi");
                result = result.replace(reAfter, " ");
            }

            // 3) Full name
            var fullRe = new RegExp("\\b" + fullEsc + "\\b", "gi");
            result = result.replace(fullRe, " ");

            // 4) First or Last name + 's
            var parts = trimmedName.split(/\s+/);
            for (var j = 0; j < parts.length; j++) {
                var part = parts[j];
                if (!part) continue;

                var partEsc = escapeRegex(part);

                var possessivePartRe = new RegExp(
                    "\\b" + partEsc + "\\s*['’]s\\b",
                    "gi"
                );
                result = result.replace(possessivePartRe, " ");

                var partRe = new RegExp("\\b" + partEsc + "\\b", "gi");
                result = result.replace(partRe, " ");
            }
        }

        var changed = result !== original;
        return { value: result, changed: changed };
    }

    function removeEdgePunctuation(value) {
        let result = value;
        result = result.replace(/^[\s\-–—:;,.!?'"…]+/, "");
        result = result.replace(/[\s\-–—:;,.!?'"…]+$/, "");
        return result;
    }

    // --- Casing / Preserve-case ----------------------------------------------

    function parsePreserveCaseRegex(raw) {
        if (!raw || typeof raw !== "string" || !raw.trim()) return null;
        try {
            const trimmed = raw.trim();
            const regexLike = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
            if (regexLike) {
                const pattern = regexLike[1];
                const flags = regexLike[2] || "gi";
                return new RegExp(pattern, flags);
            }
            return new RegExp(trimmed, "gi");
        } catch (error) {
            console.warn("[TitleFormatter] Invalid preserveCasePattern regex:", error);
            return null;
        }
    }

    function shouldPreserveCase(word, preserveRegex) {
        if (!preserveRegex) return false;
        preserveRegex.lastIndex = 0;
        return preserveRegex.test(word);
    }

    function applyTitleCase(text, preserveRegex) {
        return text.replace(/\w\S*/g, (word) => {
            if (shouldPreserveCase(word, preserveRegex)) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function applySentenceCase(text, preserveRegex) {
        let result = text.toLowerCase();

        result = result.replace(/^(\s*\S)/, (m) => m.toUpperCase());

        if (preserveRegex) {
            result = result.replace(/\w+/g, (word) => {
                if (shouldPreserveCase(word, preserveRegex)) {
                    return word.toUpperCase();
                }
                return word;
            });
        }

        return result;
    }

    function applyUpperCase(text) {
        return text.toUpperCase();
    }

    function applyLowerCase(text) {
        return text.toLowerCase();
    }

    function applyCamelCase(text, preserveRegex) {
        const words = text
            .split(/\s+/)
            .map((w) => w.trim())
            .filter(Boolean);

        if (words.length === 0) return "";

        const result = words.map((word, index) => {
            if (shouldPreserveCase(word, preserveRegex)) {
                return index === 0
                    ? word.charAt(0).toLowerCase() + word.slice(1)
                    : word;
            }

            const base =
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

            if (index === 0) {
                return base.charAt(0).toLowerCase() + base.slice(1);
            }
            return base;
        });

        return result.join("");
    }

    function applyKebabCase(text, preserveRegex) {
        const words = text
            .split(/\s+/)
            .map((w) => w.trim())
            .filter(Boolean);

        if (words.length === 0) return "";

        const result = words.map((word) => {
            if (shouldPreserveCase(word, preserveRegex)) {
                return word;
            }
            return word.toLowerCase();
        });

        return result.join("-");
    }

    function applyCasing(value, settings) {
        var modeRaw = settings.casingMode;
        if (!modeRaw || typeof modeRaw !== "string") return value;

        var mode = modeRaw.trim().toUpperCase();
        if (!mode) return value;

        var preserveRegex = parsePreserveCaseRegex(settings.preserveCasePattern);

        switch (mode) {
            case "TITLECASE":
                return applyTitleCase(value, preserveRegex);
            case "SENTENCECASE":
                return applySentenceCase(value, preserveRegex);
            case "UPPERCASE":
                return value.toUpperCase();
            case "LOWERCASE":
                return value.toLowerCase();
            case "CAMELCASE":
                return applyCamelCase(value, preserveRegex);
            case "KEBABCASE":
                return applyKebabCase(value, preserveRegex);
        }

        console.warn("[TitleFormatter] Unknown casing mode:", modeRaw);
        return value;
    }


    // --- Possessive handling --------------------------------------------------

    function parsePossessivePatterns(raw) {
        if (!raw || typeof raw !== "string") return [];

        var tokens = raw.split(",").map(function (s) {
            return s.trim();
        }).filter(function (s) {
            return s.length > 0;
        });

        var patterns = [];

        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            var regexLike = token.match(/^\/(.+)\/([a-z]*)$/i);

            if (regexLike) {
                var inner = regexLike[1];
                var flagsRaw = regexLike[2] || "gi";
                if (flagsRaw.indexOf("g") === -1) flagsRaw += "g";

                var pattern = "(" + inner + ")s\\b(?!['’])";

                try {
                    patterns.push(new RegExp(pattern, flagsRaw));
                } catch (e) {
                    console.warn("[TitleFormatter] Invalid possessive regex:", token, e);
                }
            } else {
                var escaped = escapeRegex(token);
                var literalPattern = "\\b(" + escaped + ")s\\b(?!['’])";
                patterns.push(new RegExp(literalPattern, "gi"));
            }
        }

        return patterns;
    }

    function applyPossessiveTransform(value, settings, performerCount) {
        var patterns = parsePossessivePatterns(settings.possessiveBaseTerms);
        if (!patterns || patterns.length === 0) return value;

        if (settings.smartPossessive && performerCount > 1) {
            return value;
        }

        var result = value;

        for (var i = 0; i < patterns.length; i++) {
            var re = patterns[i];

            result = result.replace(re, function (match, baseWord) {
                return baseWord + "'s";
            });
        }

        return result;
    }


    // --- Main Formatting pipeline --------------------------------------------

    function cleanAndFormatTitle(rawValue, settings) {
        if (typeof rawValue !== "string") return rawValue;
        let value = rawValue;

        const performerNames = getPerformerNamesFromPage();
        const performerCount = performerNames.length;

        // 1) Normalize / Remove fancy quotes
        value = applyQuoteNormalization(value, settings);

        // 2) Remove Season/Episode patterns
        if (settings.removeSeasonEpisode) {
            value = value.replace(/[\s\-–]*S\d{1,3}[:]?E\d{1,3}/gi, "");
        }

        // 3) Remove Performer names with fallback
        if (settings.removePerformerNames) {
            if (performerNames.length > 0) {
                const beforeNames = value;
                const res = removePerformerNames(value, performerNames);
                if (res.changed) {
                    let candidate = res.value;
                    if (settings.trimWhitespace) candidate = candidate.trim();
                    if (settings.collapseWhitespace) {
                        candidate = candidate.replace(/\s+/g, " ");
                    }
                    candidate = removeEdgePunctuation(candidate);
                    if (settings.trimWhitespace) candidate = candidate.trim();
                    if (settings.collapseWhitespace) {
                        candidate = candidate.replace(/\s+/g, " ");
                    }

                    if (hasMeaningfulContent(candidate)) {
                        value = res.value;
                    } else {
                        value = beforeNames; // Revert if empty/useless
                    }
                }
            }
        }

        // 4) Whitespace pre-clean
        if (settings.trimWhitespace) value = value.trim();
        if (settings.collapseWhitespace) value = value.replace(/\s+/g, " ");

        // 5) Custom replace pairs
        const pairs = parseReplacePairs(settings.customReplacePairs);
        if (pairs.length > 0) {
            value = applyReplacePairs(value, pairs);
        }

        // 6) Whitespace again
        if (settings.trimWhitespace) value = value.trim();
        if (settings.collapseWhitespace) value = value.replace(/\s+/g, " ");

        // 7) Edge punctuation
        if (settings.removeEdgePunctuation) {
            value = removeEdgePunctuation(value);
        }

        // 8) Possessive handling
        value = applyPossessiveTransform(value, settings, performerCount);

        // 9) Final whitespace cleanup
        if (settings.trimWhitespace) value = value.trim();
        if (settings.collapseWhitespace) value = value.replace(/\s+/g, " ");

        // 10) Casing mode
        value = applyCasing(value, settings);

        return value;
    }

    // --- React input / Dirty state -------------------------------------------

    function updateReactInputValue(input, newValue) {
        if (!input) return;
        if (input.value === newValue) return;

        const proto = Object.getPrototypeOf(input);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const setter = desc && desc.set ? desc.set : null;

        if (setter) {
            setter.call(input, newValue);
        } else {
            input.value = newValue;
        }

        const evtInit = { bubbles: true };
        input.dispatchEvent(new Event("input", evtInit));
        input.dispatchEvent(new Event("change", evtInit));
    }

    async function formatSceneTitleField() {

        var settings = await getSettings();

        if (!settings.runAlways && isSceneOrganized()) {
            return;
        }

        var input =
            document.querySelector('input[name="title"]') ||
            document.querySelector("input#title");

        if (!input || typeof input.value !== "string") return;

        var original = input.value;
        var formatted = cleanAndFormatTitle(original, settings);

        if (formatted && formatted !== original) {
            updateReactInputValue(input, formatted);
            console.info("[TitleFormatter] formatted:", original, "=>", formatted);
        }
    }

    // --- Hook into ScenePage --------------------------------------

    patch.after("ScenePage", function (props, ctx, result) {
        setTimeout(formatSceneTitleField, 0);
        return result;
    });

    console.info("[TitleFormatter] UI plugin loaded");

})();
