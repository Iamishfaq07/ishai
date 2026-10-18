# Microsoft Store listing: Orbit AI Career Assistant

Paste-ready text and settings for the Partner Center submission of **Orbit AI Career Assistant**:
- Store ID `9NJ1ZXGTCZKL`
- <https://apps.microsoft.com/detail/9NJ1ZXGTCZKL>

The step-by-step guide is [docs/MICROSOFT_STORE.md](../../../docs/MICROSOFT_STORE.md). The files below follow the
order of the Partner Center pages.

| Partner Center page | File | Limit (Microsoft's) |
| --- | --- | --- |
| Pricing and availability | [pricing.md](pricing.md) | — |
| Properties | [properties.md](properties.md) | — |
| Age ratings | [age-rating.md](age-rating.md) | — |
| Store listings → Product name | [name.md](name.md) | the reserved name |
| Store listings → Description | [description.txt](description.txt) | 10,000 characters, no URLs or HTML |
| Store listings → Short description | [short-description.txt](short-description.txt) | 1,000; the first 270 show |
| Store listings → What's new in this version | [whats-new-0.1.42.txt](whats-new-0.1.42.txt) | 1,500 (updates only) |
| Store listings → Product features | [features.txt](features.txt) | 20 features × 200 characters |
| Store listings → Screenshots, Store logos | [screenshots.md](screenshots.md), [app-tile-icon-300x300.png](app-tile-icon-300x300.png) | 1366 × 768 or larger, up to 10; captions 200 |
| Store listings → Search terms | [search-terms.txt](search-terms.txt) | 7 terms, 40 characters each, 21 words in all |
| Submission options → Notes for certification, Restricted capabilities | [certification-notes.md](certification-notes.md) | — |

**Ground rules for this copy** (DECISIONS D8, D78; Store Policies 7.20):
- Plain and honest.
- Never "undetectable", "invisible", "stealth", "guaranteed job" or "cheat".
- It's for practice, and for interviews and calls where AI help is allowed.
- No competitor or Microsoft product names (10.1.1, 10.1.3). The listing never names the AI model provider.
- The AI is disclosed (11.16).
- Purchases are described with their price range (10.8.4).
- Window privacy is described as what it is: an opt-in setting that keeps Orbit's window out of screenshots,
  recordings and Windows Recall on the user's own PC.

**Keep it true.** If prices change (`ORBIT_CREDIT_PACKS_JSON`, `ORBIT_MONTHLY_PLANS_JSON`), update the description
and pricing.md in the next submission. Do the same when a feature named here changes. Check every file's length
with:

```sh
node -e "for (const f of ['description.txt','short-description.txt','whats-new-0.1.42.txt']) console.log(f, require('fs').readFileSync('marketing/store/listing/'+f,'utf8').trim().length)"
```
