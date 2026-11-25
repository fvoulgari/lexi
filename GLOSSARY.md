# Italian Notebook

A language-learning notebook with personal vocabulary, a shared vocabulary library, and independent practice records for each learner and learning direction.

## Language

**Learner account**:
A person's verified identity in Lexi, associated with exactly one learner profile. Registration is open; access to content and permission to edit it are separate from identity verification.

**Learner profile**:
A learner's display identity, learning preferences, and personal learning records, owned exclusively by one learner account. Legacy claim and recovery-request flows were retired; each account owns its current profile.
_Avoid_: User account, authenticated user

**Vocabulary card**:
One meaning expressed by a word or phrase and its equivalent in another language. The same text may appear on separate cards with different meanings; “vocabulary entry” names the same concept.
_Avoid_: Word, translation pair without a meaning

**Vocabulary library**:
The shared vocabulary cards available to their permitted audience. Publication makes shared cards available for registered learners to read and practise; it does not grant editing permission.

**Private vocabulary**:
Vocabulary cards owned and managed by one learner account. Other learners can read them only while the creator has explicitly confirmed sharing through one of their published collections.

**Collection**:
A learner-owned, ordered list of references to vocabulary cards in one language pair. A card can belong to several collections while retaining its creator and the learner's existing progress.

**Private collection**:
A collection accessible only to its creator.

**Published collection**:
A collection its creator has made discoverable and available for signed-in learners to practise. Readers see cards they can already access or cards explicitly shared through this collection by the card creator.

**Collection publication grant**:
A card creator's confirmation that one of their published collections may share a private card. Access lasts while at least one such grant remains; another learner's reference cannot extend it.

**Language pair**:
The two supported languages a collection's cards express, independent of which language is used as the prompt during practice.

**Supported language**:
A learning language Lexi can express on a card, independent of the interface language. Languages come from the registry; only rows marked publicly available are advertised by `/api/languages` and the searchable picker, so curation is a deliberate subset of backend-supported rows. Cards carry one supported language for each of their two texts, fixed when the card is created.
_Avoid_: Interface language, text position, hardcoded frontend list

**Basic language**:
A registry-backed supported language with no enhanced grammar definition. It uses the shared card fields and needs no new column, React component, CSS rule or grammar definition. Arabic, Danish, English and Japanese are basic curated languages.

**Enhanced language**:
A registry-backed supported language that adds optional grammar declared in `backend/app/grammar_definitions.json`. Italian and Greek are the enhanced curated languages; their historical fields, values and CSV representation are preserved.

**Common card field**:
A card detail meaningful in every language, such as its texts, word type and themes. It needs no language-specific definition when a new learning language is introduced.

**Language-specific grammar**:
Optional grammatical detail that belongs to one language, such as gender or inflected forms. A card only offers the definitions for its own languages. The structured store is one nullable `grammar` column keyed by language ID, not one column per language.
_Avoid_: Generic grammar, per-language grammar columns

**CSV format v2**:
A Collection CSV exchange format whose text and grammar columns are keyed by language ID and whose rows carry card and Collection identity. It round-trips any supported language pair without positional inference while version 1 and legacy aliases remain importable.

**Published shared vocabulary**:
Shared vocabulary explicitly made available to all registered learners for reading and practice. Existing shared vocabulary retains its current audience until explicitly classified.

**Library editor**:
A learner with an explicitly assigned permission to manage shared vocabulary. This permission grants no access to another learner's private collections or learning records.

**Administrator**:
A person authorized to assign or revoke library-editor permissions and manage account access. Legacy profile association is retired.

**Legacy profile claim (retired)**:
An authenticated learner's former explicit association of an unclaimed legacy learner profile with their account, authorised by an administrator-issued claim link. Claiming preserved prior learning records and granted no additional library access or editing permissions. This flow is no longer available; the definition is retained for historical records.

**Claim link (retired)**:
A former single-use, expiring authorisation for a signed-in learner to claim one specific legacy learner profile. An administrator issued it after trusted-channel identity verification and shared it manually. This flow is no longer available.

**Legacy progress request (retired)**:
A former private request from an authenticated learner for help associating previous progress, identified by an old profile name and an optional note. A matching name was never proof of ownership. This flow is no longer available.

**Profile resolution case (retired)**:
A former pending administrator review of a legacy association blocked by existing learner data. Both profiles and their learning records remained intact pending a separately reviewed migration procedure. This flow is no longer available.

**Learning direction**:
The language shown as the prompt and the language recalled as the answer within a language pair. A learner's performance in each direction is independent.
_Avoid_: Interface language

**Interface language**:
The language used for navigation, instructions, and messages, selectable between Greek, English, and Italian independently of learning direction.
_Avoid_: Learning direction

**Italian gender**:
The optional grammatical gender of the Italian expression in a vocabulary entry, independent of the Greek expression's gender.

**Greek gender**:
The optional grammatical gender of the Greek expression in a vocabulary entry, independent of the Italian expression's gender.

**Unit (historical)**:
A former teaching chapter identified by a stable code, display title, and ordering. Units were removed in `a47c39f0a019`; legacy IDs survive only as Collection `source_unit_id` metadata for old import clients. Current filtering and destinations use Collections.
_Avoid_: Category, tag

**Tag**:
A thematic label shared by vocabulary entries. An entry may have multiple tags independently of its word type and Collection.
_Avoid_: Unit, word type

**Practice session**:
A selected queue of vocabulary entries practised by one learner. Collections and card types narrow a session without assigning units to profiles. Changing learning direction retains the queue and changes the direction tested for unanswered cards.

**Card review**:
A learner's submitted Again, Hard, or Easy rating for a vocabulary entry in the direction actually tested. A card can receive multiple reviews across practice sessions; revealing an answer alone is not a review.
_Avoid_: Flip, successful answer

**Difficult card**:
A previously reviewed vocabulary entry whose recent ratings indicate difficulty for a particular learner and learning direction. An unreviewed entry is not a difficult entry.
_Avoid_: Unmastered word, due card

**Recall**:
The proportion of submitted session reviews rated Hard or Easy. It describes recall during that session rather than lasting mastery.
_Avoid_: Mastery score

**Cards practised**:
The number of distinct vocabulary cards with at least one review for a learner. Each card counts once overall and separately within each learning direction.
