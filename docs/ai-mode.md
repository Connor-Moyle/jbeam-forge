# AI mode

AI mode hands finishing work on a car to an AI the modder already uses: names, prices, weights,
structure settings, material looks, hinges and handles, vehicle scripts, configurations, vehicle
details, engine and gearbox tune, and in-game tuning options. It's optional; nothing in JBeam Forge
needs it.

## Using it

1. Toolbar → AI mode (the sparkle button). Tick the jobs, and describe the car in a sentence or two.
2. **Copy the request** and paste it into any AI chat: ChatGPT, Microsoft Copilot, Gemini, Claude,
   DeepSeek, Mistral, a local model… Free accounts work. Nothing here needs an account or sign-in.
3. Copy the AI's whole answer into the window and press **Check it**.
4. Each change is listed with what it does, or refused with the reason. Untick what you don't want and
   **Apply**: the round is one undo step.
5. **Iterate** to ask again: say what to change. The next request tells the AI what was applied, what was
   refused and why, and how the project looks now.

### Connected (optional)

Settings → AI mode → Connected sends the request and reads the answer for you, with your own key:

| Service | Key from | Notes |
|---|---|---|
| OpenAI | platform.openai.com/api-keys | ChatGPT's models |
| Anthropic | console.anthropic.com | Claude models |
| Google | aistudio.google.com/app/apikey | Gemini models; has a free tier |
| OpenRouter | openrouter.ai/keys | many models with one key |
| On this computer | none | Ollama (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`): free and offline |
| Any other | its own | any OpenAI-compatible service (Groq, Mistral, DeepSeek, Azure…) |

Keys are encrypted with the system's own storage (Windows DPAPI, the Linux keyring) and sent only to the
service they belong to. The model can be changed in the same place; empty uses a sensible default.

## How it works

The AI never edits files. A request is plain text with four parts:

1. **The rule book** (`src/shared/ai/jobs.ts`, `RULE_BOOK`): what BeamNG cars are made of, units,
   realistic weights and prices, and the rules: only use names listed in the request, stay inside the
   given ranges, change nothing it isn't sure of, answer in the format shown.
2. **The jobs**: each job's own instructions and the kinds of change it may send (`AI_JOBS`).
3. **The project**, as the jobs need it (`src/shared/ai/prompt.ts`): parts with their kind, slot,
   material, price and mass; materials; slots and the parts each can take; script templates and their
   settings; the fitted engine's and gearbox's settings with their ranges.
4. **The answer format**, with an example of each allowed change.

The answer is JSON: `{"summary": "...", "changes": [...], "notes": [...]}`, each change one of `rename`,
`describe`, `price`, `construction`, `mass`, `structure`, `hinge`, `handles`, `script`, `config`,
`modelInfo`, `material`, `powertrain`, `tuning` (`src/shared/ai/changes.ts`). Reading it is forgiving
(text around it, a code block, comments, trailing commas, curly quotes); checking it is strict
(`src/shared/ai/check.ts`): unknown names, values out of range or suspiciously far off (a mass 20 times
the current one is usually grams, not kg), changes outside the chosen jobs, the game's own materials and
parts that can't take a hinge are refused with a reason. What's kept is applied through the same
commands the app's own buttons use (`src/renderer/ai/apply.ts`), all in one undo step.

## Adding a job

1. Add it to `AI_JOBS` with its instructions, allowed changes and the project sections it needs.
2. A new kind of change: add it to `AiChangeSchema`, to `checkReply` (what makes it valid, and its
   description), to the examples in `formatText`, and to `applyChanges`.
3. Add cases to `tests/shared/aiMode.test.ts`.
