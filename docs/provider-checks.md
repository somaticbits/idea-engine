# Provider checks (release gate)

Documentation checked September 2026:

| Capability | Documentation result | Live result |
| --- | --- | --- |
| `xiaomi/mimo-v2.6-flash` model ID | Model page exists | Chat returned candidates and a valid JSON card |
| Temperature, `min_p`, reasoning, JSON response | Advertised on model page | Calls succeeded with these settings; reasoning disabled on Narrator after a 20s timeout |
| `provider.zdr` on chat requests | OpenRouter ZDR guide documents it | Sent on all chat calls; DeepSeek Flash returned Together/CoreWeave in direct smoke calls |
| `provider.data_collection: deny` | Chat routing preference | Sent on all chat calls; provider routing policy not independently audited |
| Jev `jev-1.13` via System One | OpenRouter TypeSafe guide documents it | Live batched requests returned answers |
| Jev score | Weighted index over rubric levels (0–3 for four levels) | Live score values normalized correctly |
| Jev `usage.cost` | OpenRouter TypeSafe guide documents it | Live responses supplied reported cost |
| Jev zero-retention enforcement | TypeSafe Jev endpoint appears in OpenRouter's public ZDR endpoint catalog | No per-request System One ZDR preference documented; verify account privacy policy and endpoint routing before public release |
| Model fallback with matching privacy | No fallback configured | **Unresolved** |

Never infer privacy guarantees from a submitted flag alone. OpenRouter's public ZDR endpoint list included DeepSeek Flash providers and Jev/TypeSafe endpoints on Sep 24, 2026; direct DeepSeek calls with `zdr: true` returned Together and CoreWeave. This does not prove every selected provider's contractual guarantees. Confirm OpenRouter account privacy settings and endpoint routing before public release.

Live smoke checks with a synthetic seed: one medium expansion returned eight nodes in 4.27s. One pin timed out at 20s; after disabling reasoning and raising the Narrator deadline to 60s, a pin produced a schema-valid card in 20.18s. Re-pinning returned the same card in 0.005s without additional spend. Two earlier Narrator timeouts remain conservatively reserved at $0.005 each because their provider costs are unknown. MiMo later took 49s for Narrator, twice timed out Dreamer at 20s, and once stalled for 90s. The model was changed to `deepseek/deepseek-v4.1-flash` after direct live Dreamer and structured card requests completed in 2.34s (Together) and 1.93s (CoreWeave), both with `zdr: true`. A full application expansion then completed in 2.37s: Dreamer 1.94s (Novita; $0.00012768), Jev 0.41s (TypeSafe; $0.00009488), eight filtered nodes. Provider selection and latency vary per request; this smoke run is not a latency percentile. Application chat and Jev deadlines are both 30s.

Latency tuning (September 24, 2026): the current DeepSeek Flash calls recorded in the local instance over seven days had Dreamer p50/p90 of 3.3s/13.3s (54 completions), Jev p50/p90 of 0.33s/0.42s (54 completions), and Narrator p50/p90 of 5.5s/26s (nine completions). Together handled 21 Dreamer calls with about 2s median, while Wafer handled 13 with about 10s median. Chat requests now prefer Together, CoreWeave and Novita in that order, retaining `zdr: true`, `data_collection: deny`, and OpenRouter's provider fallbacks; Jev routing is unchanged. Narrator no longer asks the model to repeat the ancestry already stored by the application. One synthetic post-change run produced 20 candidates in 1.86s (Together), filtered eight in 0.27s (TypeSafe), and produced a valid card in 2.43s (Together, 223 output tokens). A single run verifies routing and output, not a new latency percentile.

Sources: [model capabilities](https://openrouter.ai/xiaomi/mimo-v2.6-flash), [Jev integration](https://openrouter.ai/docs/guides/community/typesafe-sdk), [TypeSafe API](https://docs.typesafe.ai/api), [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr), [live ZDR endpoint catalog](https://openrouter.ai/api/v1/endpoints/zdr).
