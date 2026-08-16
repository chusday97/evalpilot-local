# Connected AquaGuide Blind Smoke

This phase validates the calibrated connected-model path against the pinned AquaGuide product rather than only controlled probe pages.

Initial scope is deliberately narrow:

- pinned AquaGuide commit `8663b469c50605529367daf1b69ac0cd7cfb0cac`
- provider `deepseek`
- model `deepseek-v4-flash`
- one repetition only
- three existing Blind Experience journeys: create freshwater aquarium, record existing livestock, and Daily Check
- screenshots remain disabled for provider input
- Oracle remains hidden from the Actor and visible only to the Judge

The first run is a smoke test. It must preserve raw Actor decisions, browser evidence, Judge output, UX findings, and provider/evaluator failure attribution. A successful workflow run is not by itself evidence that the evaluator is correct.

Do not tune prompts, detector thresholds, or AquaGuide-specific heuristics from a single connected run. Any observed badcase should be retained first, attributed to the smallest responsible layer, and only then considered for a production change.
