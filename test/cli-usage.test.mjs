import test from 'node:test';
import assert from 'node:assert/strict';
import { cli } from './helpers.mjs';

/** The structured error a CLI run printed on stderr, with its exit status. */
function failure(args, options) {
  const result = cli(args, options);
  return { status: result.status, stdout: result.stdout, error: JSON.parse(result.stderr).error };
}

test('CLI usage errors name the right usage line and exit with status 2', () => {
  const cases = [
    [['render', 'model.json'], /^Usage: diagramc render <model\.json\|-> -o/],
    [['help', 'render', 'validate'], /^Usage: diagramc help \[command\]/],
    [['--version', 'extra'], /^--version takes no arguments\./],
    [['example'], /^Usage: diagramc example <kind>; kinds: class, /],
    [['example', 'class', 'sequence'], /^Usage: diagramc example <kind>/],
    [['rendr'], /^Unknown command "rendr"; did you mean "render"\? See diagramc --help$/],
    [['frobnicate'], /^Unknown command "frobnicate"\. See diagramc --help$/],
  ];
  for (const [args, message] of cases) {
    const { status, stdout, error } = failure(args);
    assert.equal(status, 2, args.join(' '));
    assert.equal(stdout, '', 'nothing on stdout');
    assert.equal(error.code, 'USAGE', args.join(' '));
    assert.match(error.message, message, args.join(' '));
  }
});
