# Didavero design record

Inventory: a teacher's own sources; active curriculum snapshots; branch moves; staged drafts; reviewed versions; unit/hour/criterion links; optional exam answer space; adapted exam copies; independently configured AI engines; local project files; human review before use; desktop distributions.

Argument: materials need a coherent workspace (real Notes screenshot); each output needs a different view (working selector); curriculum links need to remain inspectable (tree screenshot); human review and provider boundaries matter (explicit data-flow copy); distribution must be concrete (versioned installer and checksum); legal information must be findable (dedicated bilingual pages).

On this page, Didavero's source-to-curriculum-to-reviewed-draft workflow becomes a set of editorial folios. The live thing is a local, keyboard-accessible selector between Notes, Exams and Programmes. No preference or document is sent or persisted by that interaction.

ROUND 1
Seen in one second: a teaching preparation application, with a desktop-download action and a real product view.
Idea (one sentence): reviewed teaching work is presented as connected editorial folios.
Live thing: workspace selector with real application screenshots.
Layout words by section: hero=folio with working document / workspace=tabbed specimen / curriculum=jade folio / oversight=parallel reading / download=reply folio / faq=reading text / footer=back of folio.
Scores: design 8.0 · usability 8.2 · creativity 7.4 · content 8.3 → overall 8.0
Caps applied: no claimed certification; the public preview status and unsigned download remain explicit.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Desktop FAQ heading box stretched down its grid row (desktop DOM measurement); set align-self:start while retaining its sticky behaviour.
2. The download section initially lacked the newly named artifact (desktop screenshot); build the actual preview and wire its verified size/checksum into the static site.
3. The local prototype's snapshot descriptions needed a release boundary (desktop/tablet screenshot); explicitly distinguish preview screenshots from older GitHub downloads.

Final review records whether those changes are present, the mobile overflow measurements and any remaining distribution/legal limitations. The scores are a local design self-assessment, not an external audit.

ROUND 2
Seen in one second: Didavero, a desktop teaching-authoring app with a concrete Windows download.
Idea (one sentence): reviewed teaching work is presented as connected editorial folios.
Live thing: keyboard and mouse workspace selector; tested switching to Programmes.
Layout words by section: unchanged from round 1, with the verified installer and legal contact pages added.
Scores: design 8.0 · usability 8.4 · creativity 7.4 · content 8.5 → overall 8.1
Caps applied: no certification or signed-installer claims; preview status remains explicit.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Desktop FAQ heading now has intrinsic height; all visible headings fit at most two lines in desktop and mobile DOM checks.
2. Download is linked to the built and checksum-verified portable preview; older installers remain explicitly separate.
3. Public launch awaits a functioning contact-mail route, not visual polishing. Prepared production content is held locally until that dependency is resolved.
