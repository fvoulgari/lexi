# Italian Notebook

A shared Italian–Greek vocabulary library with independent practice records for each learner and learning direction.

## Language

**Learner profile**:
A learner's display identity and preferences, associated with their own learning records. Selecting a profile does not authenticate the person using it.
_Avoid_: User account, authenticated user

**Vocabulary card**:
One meaning expressed by an Italian word or phrase and its Greek equivalent. The same text may appear on separate cards with different meanings; “vocabulary entry” names the same concept.
_Avoid_: Word, translation pair without a meaning

**Vocabulary library**:
The vocabulary entries shared by all learners. Everyone admitted to the application is trusted to edit the library and select any learner profile.

**Learning direction**:
The language shown as the prompt and the language recalled as the answer: Italian to Greek or Greek to Italian. A learner's performance in each direction is independent.
_Avoid_: Interface language

**Interface language**:
The language used for navigation, instructions, and messages, selectable between Greek, English, and Italian independently of learning direction.
_Avoid_: Learning direction

**Italian gender**:
The optional grammatical gender of the Italian expression in a vocabulary entry, independent of the Greek expression's gender.

**Greek gender**:
The optional grammatical gender of the Greek expression in a vocabulary entry, independent of the Italian expression's gender.

**Unit**:
An optional teaching chapter identified by a stable code, display title, and ordering. Each entry belongs to at most one unit.
_Avoid_: Category, tag

**Tag**:
A thematic label shared by vocabulary entries. An entry may have multiple tags independently of its unit and word type.
_Avoid_: Unit, word type

**Practice session**:
A selected queue of vocabulary entries practised by one learner. Changing learning direction retains the queue and changes the direction tested for unanswered cards.

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
