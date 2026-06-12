# Reflection

- The highest-value fix was re-establishing single ownership boundaries:
  - graph query direction belongs in the graph fetch path
  - custom chunk rebuild busy state belongs in the async rebuild implementation, not both route and worker
- The frontend failures were mostly environment-coupling problems:
  - module-import time `localStorage` access
  - Vite plugin drift from the actual dependency set
- The remaining backend failures were stale tests, not stale product behavior. Updating the tests to the retired prompt-management contract and current role-llm surface was the right repair.
- Residual cleanup that can be done later without behavioral risk:
  - remove dead prompt-version locale keys
  - decide whether the unrelated tool-ignore entry should stay
