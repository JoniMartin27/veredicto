# Veredicto documentation

Start at the top and go as deep as you need. Every page is written to be read on its own.

| Page | Read it when |
| --- | --- |
| [Getting started](GETTING-STARTED.md) | You have never run Veredicto. Install, first PR, reading the result, graduating to blocking. |
| [Rule catalog](RULES.md) | You want to know exactly what each of the 11 detectors flags, with a snippet that trips it and how to suppress it. |
| [Configuration](CONFIGURATION.md) | You need the full reference: inputs, outputs, permissions, environment, exit codes, GitLab, monorepos. |
| [Limitations](LIMITATIONS.md) | Before you trust a green check. What Veredicto provably does **not** catch, measured. |
| [Troubleshooting](TROUBLESHOOTING.md) | It ran but did nothing, posted no comment, or flagged something you think is wrong. |
| [Architecture](ARCHITECTURE.md) | You want to read the source, add a detector, or audit what runs on your CI. |
| [Contributing](../CONTRIBUTING.md) | You are writing a detector or opening a PR. |
| [Changelog](../CHANGELOG.md) | You are upgrading and want to know what changed. |

## The one-paragraph version

Veredicto is a GitHub Action (and GitLab CI job) that reads the **diff** of a pull
request and flags the concrete tricks used to turn CI green without doing the work:
deleted tests, `.skip`, assertions that can never fail, assertions quietly removed,
coverage gates lowered, CI steps disarmed. It is **static and deterministic** — regular
expressions over the diff, no LLM, no API key, no network call, zero dependencies. It
runs in seconds, and nothing about your code leaves the runner.

It is a **cheap first line of defense, not proof that your tests are good.** Read
[Limitations](LIMITATIONS.md) before you rely on it.
