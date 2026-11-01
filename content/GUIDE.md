# Content guide

All content is family friendly and original. Each language is written natively, never as a literal translation of the other.

## Language style
- English: natural, short, clear.
- Arabic party words (Spy, Charades, Taboo, Word grid, Draw and guess): Lebanese dialect, Arabic script (no Arabizi). Example tone: "عجقة سير", "منقوشة زعتر", "تبولة".
- Arabic trivia: Modern Standard Arabic (فصحى), clear and short.
- No Kuwaiti dialect. Lebanese flavour where it fits. Kuwaiti places and culture are welcome as subjects.

## Always avoid
- Anything time sensitive: current office holders, "current" champions, records likely to change, recent transfers, prices, populations given as exact numbers, anything after 2023 that could change.
- Politics, parties, wars and blame, sectarian or religious topics that divide people, borders in dispute, Israel and Palestine, Lebanese political figures.
- Anything rude, romantic, alcohol, gambling, scary or unkind about any group.
- Trademarks or text copied from commercial games.

## Files
- Drafts: content/drafts/... Final, checked: content/trivia/<lang>/<topic>.json and content/packs/<lang>/<pack>.json.
- Trivia item: {"id","topic","difficulty":1|2|3,"lang":"ar"|"en","q","options":[4 strings],"answer":0..3,"source":"short note"}
  topics: lbkw (Lebanon and Kuwait), sport (football and sport), histgeo (history and geography), science (science, tech and space).
- spy.json: [{"id","place","pack":"lebanon"|"kuwait"|"general","roles":[5 to 7 strings]}]
- charades.json: [{"id","word","pack","difficulty":1|2|3}]
- taboo.json: [{"id","word","banned":[5 strings]}]
- wordgrid.json: [{"id","word"}]  single common nouns, 1 word, easy to say
- draw.json: [{"id","word","difficulty":1|2|3}]  concrete, drawable things
