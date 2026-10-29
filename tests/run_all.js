#!/usr/bin/env node
/**
 * tests/run_all.js
 *
 * Master Unified Test Runner for Antigravity Multi-Account Test Infrastructure.
 * Runs Tiers 1-4 plus dedicated Python Win32 Credential Suite.
 *
 * Usage:
 *   node tests/run_all.js
 *   node tests/run_all.js [tier1|tier2|tier3|tier4|python]
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

const SUITES = [
    {
        id: 'tier1',
        name: 'Tier 1: Feature Coverage (R1, R2, R3, R4)',
        command: 'node',
        args: [path.join(TESTS_DIR, 'tier1_feature_coverage.test.js')]
    },
    {
        id: 'tier2',
        name: 'Tier 2: Boundary & Corner Cases',
        command: 'node',
        args: [path.join(TESTS_DIR, 'tier2_boundary_cases.test.js')]
    },
    {
        id: 'tier3',
        name: 'Tier 3: Cross-Feature Combinations',
        command: 'node',
        args: [path.join(TESTS_DIR, 'tier3_cross_feature.test.js')]
    },
    {
        id: 'tier4',
        name: 'Tier 4: Real-World Application Scenarios',
        command: 'node',
        args: [path.join(TESTS_DIR, 'tier4_real_world.test.js')]
    },
    {
        id: 'python',
        name: 'Python Win32 Credential Manager & Compaction Suite',
        command: 'python',
        args: [path.join(TESTS_DIR, 'cred_helper_suite.py')]
    }
];

function printHeader() {
    console.log('='.repeat(78));
    console.log('   ANTIGRAVITY MULTI-ACCOUNT UNIFIED E2E TEST RUNNER (TIERS 1-4)');
    console.log('   Authoritative Sources: ORIGINAL_REQUEST.md, PROJECT.md');
    console.log('='.repeat(78));
    console.log();
}

function parseTapOutput(stdout) {
    let passed = 0;
    let failed = 0;
    const lines = stdout.split('\n');

    for (const line of lines) {
        if (/^✔\s+/.test(line.trim())) {
            passed++;
        } else if (/^✖\s+/.test(line.trim())) {
            failed++;
        } else if (/Ran (\d+) tests/i.test(line)) {
            const m = /Ran (\d+) tests/i.exec(line);
            passed += parseInt(m[1], 10);
        } else if (/FAILED \(failures=(\d+)/i.test(line)) {
            const m = /FAILED \(failures=(\d+)/i.exec(line);
            failed += parseInt(m[1], 10);
        }
    }

    return { passed, failed };
}

async function main() {
    printHeader();

    const filterArg = process.argv[2] ? process.argv[2].toLowerCase().replace(/^--?/, '') : null;
    const suitesToRun = filterArg
        ? SUITES.filter(s => s.id === filterArg || s.id.includes(filterArg))
        : SUITES;

    if (suitesToRun.length === 0) {
        console.error(`Unknown suite filter: "${filterArg}". Valid options: ${SUITES.map(s => s.id).join(', ')}`);
        process.exit(1);
    }

    const startTime = Date.now();
    const suiteResults = [];
    let overallSuccess = true;
    let totalPassCount = 0;
    let totalFailCount = 0;

    for (const suite of suitesToRun) {
        console.log(`\n>>> Executing: ${suite.name}...`);
        const suiteStart = Date.now();

        const res = spawnSync(suite.command, suite.args, {
            cwd: ROOT_DIR,
            encoding: 'utf-8',
            env: { ...process.env, NODE_ENV: 'test' }
        });

        const suiteDuration = ((Date.now() - suiteStart) / 1000).toFixed(2);
        const stdout = res.stdout || '';
        const stderr = res.stderr || '';

        // Print raw output indented
        const combinedOutput = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : '');
        const indentedOutput = combinedOutput.split('\n').map(l => `  ${l}`).join('\n');
        console.log(indentedOutput);

        const { passed, failed } = parseTapOutput(combinedOutput);
        const success = res.status === 0 && failed === 0;

        totalPassCount += passed;
        totalFailCount += failed;
        if (!success) overallSuccess = false;

        suiteResults.push({
            id: suite.id,
            name: suite.name,
            passed,
            failed,
            duration: `${suiteDuration}s`,
            status: success ? 'PASS' : 'FAIL'
        });
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(78));
    console.log('                          TEST EXECUTION SUMMARY');
    console.log('='.repeat(78));
    console.log(
        'Suite'.padEnd(52) +
        'Status'.padEnd(10) +
        'Passed'.padEnd(8) +
        'Failed'.padEnd(8)
    );
    console.log('-'.repeat(78));

    for (const r of suiteResults) {
        const statusStr = r.status === 'PASS' ? '✔ PASS' : '✖ FAIL';
        console.log(
            r.name.padEnd(52) +
            statusStr.padEnd(10) +
            String(r.passed).padEnd(8) +
            String(r.failed).padEnd(8)
        );
    }

    console.log('='.repeat(78));
    console.log(`Total Passed: ${totalPassCount} | Total Failed: ${totalFailCount} | Duration: ${totalDuration}s`);
    console.log(`Final Result: ${overallSuccess ? '✔ 100% ALL TESTS PASSED' : '✖ SOME TESTS FAILED'}`);
    console.log('='.repeat(78) + '\n');

    process.exit(overallSuccess ? 0 : 1);
}

main().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
