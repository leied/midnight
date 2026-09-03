# icons/

`icons.json` holds the brand marks this page actually uses — the SVG path, the brand colour, and
every name that resolves to it. It is generated: each build copies in any mark the config newly
needs and drops any mark no longer used, so it stays a few kB rather than the 15 MB of the full
set. **Don't edit it by hand.**

Because the marks live here, `build.mjs` needs no dependency to produce `dist/index.html` —
`simple-icons` is only consulted when a build asks for a brand that isn't committed yet.

## Provenance

Marks come from [Simple Icons](https://github.com/simple-icons/simple-icons), released under
[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, no attribution
required, redistribution explicitly allowed. The `version` field records which release each mark
was copied from.

The waiver covers Simple Icons' own work, not the brands. Each mark remains a trademark of its
owner: use a company's mark to link to that company, and follow their brand guidelines for
anything beyond that. See Simple Icons'
[legal disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).
