# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately,
either through GitHub's "Report a vulnerability" button on the
[Security tab](https://github.com/vladbagmet/uml_cli/security) of this
repository or by e-mail to [SECURITY CONTACT ADDRESS TO BE FILLED IN BY THE MAINTAINER].

Include what you did, what happened, and the smallest model JSON or command that
shows it. You should get an answer within a week. Once a fix is released, we are
glad to credit you in the changelog if you want.

## Supported versions

Security fixes go into the latest release only.

## Scope

`uml` reads untrusted model files and writes SVG or PNG, so these are in scope:

- **Output safety.** Text from a model must appear literally in the drawing. Any
  input that produces active SVG content (scripts, event handlers, external
  references, links) or markup the input did not ask for is a vulnerability.
- **The PlantUML runner.** Sequence, timing and activity models are turned into
  PlantUML source and rendered by a Java child process without a shell, under
  PlantUML's SECURE profile, with time, memory and output limits. Any input that
  injects PlantUML directives, reads or writes files, opens network connections
  or escapes those limits is in scope.
- **The renderer setup.** `npm run setup:renderer` (`scripts/setup-renderer.mjs`)
  downloads PlantUML and an Eclipse Temurin Java runtime from their official
  GitHub releases and verifies each download against a SHA-256 pinned in the
  script before using it. Ways to make it use unverified bytes, write outside its
  `.tools/` directory, or leave a half-installed runtime in use are in scope.
- **Resource limits.** Inputs that make the CLI hang, crash or use unbounded
  memory despite the input size limit (256 KiB) and output limit (8 MiB).

Out of scope: vulnerabilities in Java, PlantUML or npm dependencies themselves
(report those upstream; tell us if we should update a pin), and setups where
`UML_JAVA` and `PLANTUML_JAR` point at binaries you chose to trust.
