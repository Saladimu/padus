'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_JS = path.join(__dirname, '..', 'app.js');
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('Function not found in app.js: ' + name);
    let depth = 0;
    let started = false;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') {
            depth--;
            if (started && depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('Unbalanced braces while extracting: ' + name);
}

function loadHelpers() {
    const source = fs.readFileSync(APP_JS, 'utf8');
    const sandbox = { MAINT_ALL_DAYS: ALL_DAYS.slice() };
    vm.createContext(sandbox);
    vm.runInContext(
        extractFunction(source, 'coerceMaintenanceDaysInput') + '\n\n' +
        extractFunction(source, 'normalizeMaintenanceDays') + '\n',
        sandbox
    );
    return sandbox;
}

// Hasil dari vm adalah array realm lain; salin ke array Node agar deepStrictEqual akurat.
function arr(value) {
    return value === null || value === undefined ? value : Array.from(value);
}

const helpers = loadHelpers();
const coerce = helpers.coerceMaintenanceDaysInput;
const normalize = helpers.normalizeMaintenanceDays;

test('coerceMaintenanceDaysInput: null/undefined/empty -> null', () => {
    assert.equal(coerce(null), null);
    assert.equal(coerce(undefined), null);
    assert.equal(coerce(''), null);
});

test('coerceMaintenanceDaysInput: blank string -> []', () => {
    assert.deepEqual(arr(coerce('   ')), []);
});

test('coerceMaintenanceDaysInput: arrays pass through', () => {
    assert.deepEqual(arr(coerce([2, 4])), [2, 4]);
    assert.deepEqual(arr(coerce([])), []);
});

test('coerceMaintenanceDaysInput: JSON string', () => {
    assert.deepEqual(arr(coerce('[0,6]')), [0, 6]);
    assert.deepEqual(arr(coerce('[1,2,3]')), [1, 2, 3]);
});

test('coerceMaintenanceDaysInput: malformed JSON string -> []', () => {
    assert.deepEqual(arr(coerce('[not json')), []);
});

test('coerceMaintenanceDaysInput: CSV and whitespace strings', () => {
    assert.deepEqual(arr(coerce('1,2,3')), ['1', '2', '3']);
    assert.deepEqual(arr(coerce('1 2 3')), ['1', '2', '3']);
});

test('coerceMaintenanceDaysInput: array-like and numeric-key objects', () => {
    assert.deepEqual(arr(coerce({ length: 2, 0: 1, 1: 2 })), [1, 2]);
    assert.deepEqual(arr(coerce({ 1: 5, 0: 3 })), [3, 5]);
});

test('coerceMaintenanceDaysInput: non-numeric object -> null', () => {
    assert.equal(coerce({ foo: 'bar' }), null);
});

test('normalizeMaintenanceDays: missing/empty -> all days', () => {
    assert.deepEqual(arr(normalize(null)), ALL_DAYS.slice());
    assert.deepEqual(arr(normalize(undefined)), ALL_DAYS.slice());
    assert.deepEqual(arr(normalize('')), ALL_DAYS.slice());
});

test('normalizeMaintenanceDays: explicit empty -> []', () => {
    assert.deepEqual(arr(normalize([])), []);
    assert.deepEqual(arr(normalize('[]')), []);
});

test('normalizeMaintenanceDays: dedupes, filters out-of-range, sorts', () => {
    assert.deepEqual(arr(normalize([3, 1, 1, 9, -1, 6, '2'])), [1, 2, 3, 6]);
});

test('normalizeMaintenanceDays: CSV string', () => {
    assert.deepEqual(arr(normalize('1,2,3')), [1, 2, 3]);
});

test('normalizeMaintenanceDays: does not mutate MAINT_ALL_DAYS', () => {
    const result = normalize(null);
    result.push(99);
    assert.deepEqual(helpers.MAINT_ALL_DAYS, ALL_DAYS);
});
