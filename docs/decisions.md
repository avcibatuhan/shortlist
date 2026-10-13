# Decisions

## Redesign after mock-ups (2026-10-13)

The owner supplied seven screen designs and a design system (not part of this repository).
The frontend follows
their layout, palette, type and components. The mock-ups also show data and functions the app
does not have; those were left out rather than faked, so every number on screen still comes
from the API:

| In the mock-up | In the app |
|---|---|
| Match percentage on rows, "Confidence 94.2%" | The LLM gives yes / no and a reason; shown as a verdict chip and the reason |
| Parsed stack chips, "0 missing critical skills", extracted requirements | Not extracted by the pipeline; left out |
| Salary band "market verified", language level per job | Salary and posting language as the source gave them |
| Sidebar filters (target roles, minimum match, salary) | Left out; the real filters are in the Jobs toolbar |
| "Quick Ingest" | A link to the fetch button on Today (`f`); a paid run is never started without the cost in view |
| "Triage Protocol" panel with fixed text | "Next steps", computed from the real counts |
| Tracker: contacts, activity log, manual job, "96% fit" | Stage, notes, cover letter and the posting |
| History: runtime, HTTP status, model per run, month-end forecast, CSV export | Cost of the month, runs, average cost, accounting per run |
| Settings: CV import, name and seniority fields, skill tokens, sync schedule | The existing settings; there is no scheduler by design |
| Avatar, "PRO" / version badges, terminal button | Left out |
| Backend response time "24ms" | Measured in the browser for each health check |
| Google Fonts, Material icons from the network | Bundled Geist and JetBrains Mono, lucide icons (local-first) |

The light theme is not in the mock-ups; it was derived from the same colour roles.

## Default model: `gemma4:12b-it-qat` (2026-10-13)

The owner made `gemma4:12b-it-qat` the default, later the same day as the choice below, and
asked for a model picker in the dashboard's top bar. Every installed Ollama model can be
selected there; the choice applies to the next decision or cover letter.

This is the owner's preference, not the result of the comparison: in the measurements below
`gemma4:12b-it-qat` is about twice as slow per job as `qwen3.5:9b` and runs partly on the CPU,
and accuracy has not been measured for either model.

## Cover letters (2026-10-13)

A button on a job card lets the LLM write a cover letter (Anschreiben) for that job
([cover_letter.py](../backend/src/shortlist/llm/cover_letter.py)).

- **Only on request.** Nothing is written during a run.
- **Language of the posting:** German for German postings, English otherwise.
- **One page:** the prompt asks for 220 to 300 words and forbids more than 350; output is
  capped, a longer draft is requested again once, and a letter that is still too long is shown
  with a warning instead of being cut.
- **Facts from the profile only:** the prompt forbids inventing experience. This is not
  enforced by code; in the first real letters the model still borrowed details from the job ad
  as if they were the candidate's experience. The dialog therefore says the letter is a draft
  to check, and the text is editable.
- **Name:** Settings has a name field. Signing is done in code after the model answers:
  placeholders such as `[Ihr Name]` are replaced and a missing name is appended, so the
  result does not depend on the model following the instruction. Without a name the letter
  ends with the placeholder. There is still no address block.
- **PDF:** made on the backend with `fpdf2` from the saved text, on one A4 page, with the
  bundled Liberation Sans font (the standard PDF fonts only cover Latin-1, which is not enough
  for many names).

## LLM: `qwen3.5:9b` (2026-10-13, superseded as default)

The owner chose `qwen3.5:9b` (6.6 GB download) over the spec's `qwen3.5:4b` after trying it on
the development machine (RTX 4060 Laptop, 8 GB VRAM).

- The spec advised against this size, expecting it to spill over to the CPU. On this machine
  `ollama ps` shows the model completely on the GPU at the app's 8K context (`num_ctx` 8192),
  so the reason for the smaller model does not apply here.
- Requests use thinking off, temperature 0, a fixed seed and a JSON schema
  ([ollama_client.py](../backend/src/shortlist/llm/ollama_client.py)).
- The model is a setting (Settings page); switching needs no code change. "Test connection"
  there reports the latency of a sample decision and how much of the model is on the GPU.

### Comparison so far (2026-10-13)

Candidates, all run with `shortlist eval --all` on the 29 jobs stored at the time; the numbers
are in [eval/results/](../eval/results/) and in the README table:

- `qwen3.5:9b`, normal prompt: the fastest, and the only candidate fully on the GPU with time
  to spare.
- `gemma4:12b-it-qat`, normal prompt: about twice as slow per job, with part of the model on
  the CPU. A bigger model, but not a better fit for this card.
- `qwen3.5:9b`, checklist prompt: the model fills in facts (role, seniority, years required,
  an unmet hard requirement, location) and the decision is computed from them by fixed rules.
  About twice as slow as the normal prompt because it writes more.

Also tried and dropped: the model's thinking mode (1.5 to 2 minutes per job, stopped
before it finished), and the Qwen 3.8 generation (smallest download 18 GB, does not fit).
Purpose-built decision models (`nimble`, `kev`, `tev1`) return probabilities without text and
cannot give the reason shown on the cards.

**Accuracy is not measured yet**: no jobs have been labelled, so the result files contain
speed and valid-JSON rates only. Revisit when 50 to 100 jobs are labelled:
`make eval MODEL=<name> [PROMPT=v3-checklist]` for each candidate, then compare accuracy first
and speed second, as spec §9 says.

## Prompts (2026-10-13)

[prompts.py](../backend/src/shortlist/llm/prompts.py) follows the decision guidance of spec
§6.5. Two clarifications were added after reading the decisions on the first real jobs, where
the model rejected jobs for reasons the spec does not intend:

- Any German city counts as "in Germany", on-site and hybrid included; postings come from
  German job boards, so Germany is assumed unless another country is named.
- Missing information is not a reason to reject (short StepStone snippets were rejected
  because they "did not confirm" the location or the role).

**`v2` (current):** personal limits are no longer written into the rules. `v1` named specific
limits of the owner; now the rule is general — reject when the posting makes something a hard
requirement that the profile says the candidate does not have — and the limits themselves
stand in the owner's profile, which stays in the local database. The checklist prompt became
`v3-checklist` with the same change. The result files in `eval/results/` were measured with
these versions.

The prompt version is stored with every decision. A change of wording needs a new version.
