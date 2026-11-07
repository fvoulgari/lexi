# Published Italian Notebook tickets

Published with the GitHub CLI to fvoulgari/lexi. All tickets carry ready-for-agent; blockers are native GitHub issue dependencies. The source was the local specification, so no parent issue was created or modified.

| Slice | GitHub issue | Blocked by |
| --- | --- | --- |
| 1 | [Run a protected, seeded vocabulary library](https://github.com/fvoulgari/lexi/issues/1) | None |
| 2 | [Select learners and persist practice preferences](https://github.com/fvoulgari/lexi/issues/2) | #1 |
| 3 | [Add and edit vocabulary meanings](https://github.com/fvoulgari/lexi/issues/3) | #1 |
| 4 | [Organize and find vocabulary by units and tags](https://github.com/fvoulgari/lexi/issues/4) | #3 |
| 5 | [Complete random practice with persisted reviews](https://github.com/fvoulgari/lexi/issues/5) | #2 |
| 6 | [Switch direction and recover review saves safely](https://github.com/fvoulgari/lexi/issues/6) | #5, #3 |
| 7 | [Delete accidental unreviewed vocabulary safely](https://github.com/fvoulgari/lexi/issues/7) | #6 |
| 8 | [Practise categories from combined filters](https://github.com/fvoulgari/lexi/issues/8) | #4, #5 |
| 9 | [Find and practise difficult entries](https://github.com/fvoulgari/lexi/issues/9) | #6 |
| 10 | [Combine difficult, recent, and random practice](https://github.com/fvoulgari/lexi/issues/10) | #9 |
| 11 | [Preview and confirm CSV vocabulary imports](https://github.com/fvoulgari/lexi/issues/11) | #4 |
| 12 | [Export vocabulary safely as CSV](https://github.com/fvoulgari/lexi/issues/12) | #4 |
| 13 | [Show learner progress and a useful home page](https://github.com/fvoulgari/lexi/issues/13) | #9 |
| 14 | [Choose Greek, English, or Italian interface settings](https://github.com/fvoulgari/lexi/issues/14) | #2 |
| 15 | [Install the PWA with safe static caching](https://github.com/fvoulgari/lexi/issues/15) | #6 |
| 16 | [Verify and document the complete Railway release](https://github.com/fvoulgari/lexi/issues/16) | #7, #8, #10, #11, #12, #13, #14, #15 |

## Authentication and account isolation

Approved specification: [#52](https://github.com/fvoulgari/lexi/issues/52). These ten issues are its native sub-issues, all labelled `ready-for-agent`, with native blocking relationships. The parent remains open.

| Slice | GitHub issue | Blocked by |
| --- | --- | --- |
| 1 | [Sign in to an isolated learner account](https://github.com/fvoulgari/lexi/issues/53) | None |
| 2 | [Retain legacy learners and their restricted library safely](https://github.com/fvoulgari/lexi/issues/54) | #53 |
| 3 | [Create and practise private vocabulary](https://github.com/fvoulgari/lexi/issues/55) | #53 |
| 4 | [Publish and maintain shared vocabulary without erasing history](https://github.com/fvoulgari/lexi/issues/56) | #54, #55 |
| 5 | [Import, export, and bulk-manage authorised vocabulary](https://github.com/fvoulgari/lexi/issues/57) | #55, #56 |
| 6 | [Organise private collections and personal variants](https://github.com/fvoulgari/lexi/issues/58) | #55, #56 |
| 7 | [Persist account preferences across devices](https://github.com/fvoulgari/lexi/issues/59) | #53 |
| 8 | [Claim legacy progress through administrator-issued links](https://github.com/fvoulgari/lexi/issues/60) | #54, #57, #58 |
| 9 | [Request help recovering legacy progress privately](https://github.com/fvoulgari/lexi/issues/61) | #60 |
| 10 | [Verify and document the integrated authentication release](https://github.com/fvoulgari/lexi/issues/62) | #53, #54, #55, #56, #57, #58, #59, #60, #61 |
