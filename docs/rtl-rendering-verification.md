# RTL and non-Latin rendering verification (#120)

This records the UI work for [issue #120](https://github.com/fvoulgari/lexi/issues/120). Language direction, script and `lang` identity come only from the curated `/api/languages` registry. The interface language remains independent: no document-level `dir` is set from the language being studied.

## What changed

- `frontend/src/languages.js` exposes `languageDirection`, `languageScript` and `languageTextProps`. Every language-text element spreads the same metadata attributes (`lang`, `dir`, `data-script`).
- Authoring inputs (`CollectionCardForm`, `VocabularyForm`, `CardFields`), previews (`CardPreview`, `PracticeCardView`), practice summaries, Library, Collections, Progress, Import previews and the language picker all use that helper. Pronunciations and notes remain interface-language text and are intentionally untagged.
- `frontend/src/styles.css` uses script-level font fallback stacks (Arabic/Hebrew, CJK, Indic), isolates bidirectional text and uses logical `text-align`/positioning in card surfaces. The two old `[lang="el"]` rules were replaced with role-based selectors, so no per-language CSS remains.

A synthetic `rtl`/`Arab` catalogue row is enough to exercise the whole flow; no component, CSS rule or migration is added per language.

## Automated coverage

- `frontend/src/languages.test.js`: metadata helpers, mixed pairs, unloaded-registry fallback.
- `frontend/src/text-direction.test.jsx`: authoring inputs, Unicode payload, card preview, reversed practice direction and picker labels with an RTL registry row.
- `frontend/tests/rtl-rendering.mjs`: real-browser checks at 320/390/760 px against a loopback API that serves an RTL `ar` row. Asserts computed `direction: rtl`, mirrored `text-align: start`, LTR preservation in the same mixed pair and no horizontal overflow.

## Reproduction

```sh
npm test
npm run lint
npm run build
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:rtl
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:language-picker
```

## Recorded result

- Frontend: 322 tests passed in 30 files; ESLint clean; production build clean (existing bundle-size warning only).
- RTL browser checks: passed at 320, 390 and 760 px.
- Language-picker browser checks: passed at 320, 390 and 760 px.
- `frontend/tests/mobile-navigation.mjs` and `frontend/tests/pwa.mjs` were timing out on selectors and registry fixtures left behind by the earlier UI changes; the same failures reproduced on the unmodified merge base, so they were unrelated to this change. Follow-up browser-fixture updates restore them to green.
- Backend is unchanged by #120; the existing UTF-8 CSV and Unicode round-trip coverage remains in place.
