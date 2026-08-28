# v0.1 acceptance suite

This hermetic suite exercises the public CLI against disposable loopback HTTP targets. It covers
matching behavior; status, nested JSON, authorization, and latency regressions; unavailable and
timed-out targets; failed request setup; interruption; and malformed configuration.

Run it from the repository root:

```shell
npm run test:acceptance
```

Every case asserts the CLI exit code and the resulting evidence state. Malformed configuration is
the deliberate exception to artifact creation: it must return invalid input and leave evidence
absent rather than manufacture an `incomplete` or passing artifact.

The suite uses fixed, non-production secret canaries to confirm generated fixtures, captured CLI
output, canonical evidence, Markdown, and JUnit reports do not expose runtime credentials. Its
uploadable summary contains only case identifiers, exit codes, evidence states, and pass/fail flags.
CI runs `npm run verify:acceptance-diagnostics` before the artifact upload step; missing, malformed,
or canary-containing diagnostics are never uploaded.
